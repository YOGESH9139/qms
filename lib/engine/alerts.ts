// Rule-based bottleneck alerts (CLAUDE.md 9.3). Pure. `why` is plain English with numbers.

import { SERVICE_BY_ID } from "@/lib/data/catalog";
import type { Category, Counter, Skill, Staff, Token } from "@/lib/types";

import { avgHandleFor, minutesBetween, type QueueContext } from "./queue";

export const CATEGORY_TARGET: Record<Category, number> = { QUICK: 10, STANDARD: 15, COMPLEX: 20 };
export const CATEGORY_NAME: Record<Category, string> = { QUICK: "Quick", STANDARD: "Standard", COMPLEX: "Complex" };
export const CATEGORY_SKILLS: Record<Category, Skill[]> = { QUICK: ["QUICK"], STANDARD: ["STANDARD"], COMPLEX: ["COMPLEX", "LOANS"] };

export interface Snapshot {
  ctx: QueueContext;
  tokens: Token[];
  counters: Counter[];
  staff: Pick<Staff, "id" | "name" | "skills">[];
  staffSkills: Record<string, Skill[]>;
  waitByCategory: Record<string, number>;
  /** Erlang need vs available for the next 2 hours. */
  gaps: { hour: number; category: Category; needed: number; available: number }[];
  recentRatings: number[];
  transfersToday: Record<string, number>;
  callsLastHour: number;
  noShowsLastHour: number;
  /** Real (unplanned) break end, if a scenario is running. */
  actualBreakEnd?: Record<string, string>;
}

export interface AlertDraft {
  type: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  title: string;
  why: string;
  dedupe_key: string;
}

export function categoryOf(t: Token): Category {
  return SERVICE_BY_ID[t.service_id].category;
}

export function staffName(s: Snapshot, staffId: string | null): string {
  return s.staff.find((x) => x.id === staffId)?.name.split(" ")[0] ?? "Unassigned";
}

/** "Only 1 of 3 Standard-skilled staff is serving Standard (Anita on break, Ravi on Quick focus)". */
export function coverageText(s: Snapshot, cat: Category): string {
  const skills = CATEGORY_SKILLS[cat];
  const skilled = s.counters.filter((c) => c.staff_id && (s.staffSkills[c.staff_id] ?? []).some((k) => skills.includes(k)));
  const focused = skilled.filter((c) => c.status !== "OFFLINE" && c.status !== "ON_BREAK" && c.mode_skill && skills.includes(c.mode_skill));
  const notes = skilled
    .filter((c) => !focused.includes(c))
    .map((c) => {
      const n = staffName(s, c.staff_id);
      if (c.status === "OFFLINE") return `${n} offline`;
      if (c.status === "ON_BREAK") return `${n} on break`;
      const other = c.mode_skill as Category | null;
      const q = other && other in CATEGORY_NAME ? s.tokens.filter((t) => t.status === "WAITING" && categoryOf(t) === other).length : 0;
      return `${n} on ${other ? CATEGORY_NAME[other as Category] ?? other : "general"} counter where the queue is ${q}`;
    });
  return `Only ${focused.length} of ${skilled.length} ${CATEGORY_NAME[cat]}-skilled staff ${focused.length === 1 ? "is" : "are"} focused on it${notes.length ? ` (${notes.join(", ")})` : ""}.`;
}

export function runAlertRules(s: Snapshot): AlertDraft[] {
  const out: AlertDraft[] = [];
  const now = s.ctx.now;

  // Queue overload: projected wait > 1.5× target
  for (const cat of ["QUICK", "STANDARD", "COMPLEX"] as Category[]) {
    const wait = s.waitByCategory[cat] ?? 0;
    const target = CATEGORY_TARGET[cat];
    if (wait > 1.5 * target) {
      const waiting = s.tokens.filter((t) => t.status === "WAITING" && categoryOf(t) === cat).length;
      out.push({
        type: "QUEUE_OVERLOAD",
        severity: wait > 2.5 * target ? "CRITICAL" : "WARN",
        title: `${CATEGORY_NAME[cat]} queue overloaded`,
        why: `${CATEGORY_NAME[cat]} queue: ${waiting} waiting, projected ${Math.round(wait)} min vs ${target} min target. ${coverageText(s, cat)}`,
        dedupe_key: `overload:${cat}`,
      });
    }
  }

  // Stuck counter: current handle > 2.5× avg
  for (const c of s.counters) {
    const t = s.tokens.find((x) => x.counter_id === c.id && x.status === "SERVING");
    if (!t?.serving_started_at) continue;
    const elapsed = minutesBetween(t.serving_started_at, now);
    const avg = avgHandleFor(s.ctx, t.service_id);
    if (elapsed > 2.5 * avg) {
      out.push({
        type: "STUCK_COUNTER",
        severity: "WARN",
        title: `Counter ${c.number} running long`,
        why: `${staffName(s, c.staff_id)} has been serving ${t.code} (${SERVICE_BY_ID[t.service_id].name}) for ${Math.round(elapsed)} min vs ${avg.toFixed(0)} min average. Check in with staff.`,
        dedupe_key: `stuck:${c.id}:${t.id}`,
      });
    }
  }

  // Long break: exceeded expected end by 10 min
  for (const c of s.counters) {
    if (c.status !== "ON_BREAK" || !c.break_expected_end) continue;
    const over = minutesBetween(c.break_expected_end, now);
    if (over >= 10) {
      out.push({
        type: "LONG_BREAK",
        severity: "WARN",
        title: `Counter ${c.number} break overrun`,
        why: `${staffName(s, c.staff_id)}'s ${c.break_reason ?? ""} break was due to end ${Math.round(over)} min ago. ${s.tokens.filter((t) => t.status === "WAITING").length} customers are waiting.`,
        dedupe_key: `break:${c.id}:${c.status_since}`,
      });
    }
  }

  // Forecast gap: next 2 hours Erlang need > available
  const worst = new Map<Category, (typeof s.gaps)[number]>();
  for (const g of s.gaps) {
    if (g.needed > g.available && (!worst.has(g.category) || g.needed - g.available > worst.get(g.category)!.needed - worst.get(g.category)!.available)) {
      worst.set(g.category, g);
    }
  }
  worst.forEach((g, cat) => {
    out.push({
      type: "FORECAST_GAP",
      severity: "WARN",
      title: `${CATEGORY_NAME[cat]} staffing gap at ${g.hour}:00`,
      why: `Forecast for ${g.hour}:00–${g.hour + 1}:00 needs ${g.needed} ${CATEGORY_NAME[cat]} counters (Erlang C, 80% within ${CATEGORY_TARGET[cat]} min) but only ${g.available} are available. Call in or move staff.`,
      dedupe_key: `gap:${cat}:${g.hour}`,
    });
  });

  // No-show spike: > 20% of calls in last hour
  if (s.callsLastHour >= 5 && s.noShowsLastHour / s.callsLastHour > 0.2) {
    out.push({
      type: "NO_SHOW_SPIKE",
      severity: "INFO",
      title: "No-show spike",
      why: `${s.noShowsLastHour} of ${s.callsLastHour} customers called in the last hour didn't come (${Math.round((100 * s.noShowsLastHour) / s.callsLastHour)}%). Shorten the recall grace and send SMS reminders.`,
      dedupe_key: "noshow",
    });
  }

  // Misrouting: same service transferred ≥ 3 times today
  for (const [serviceId, n] of Object.entries(s.transfersToday)) {
    if (n >= 3) {
      out.push({
        type: "MISROUTING",
        severity: "INFO",
        title: `${SERVICE_BY_ID[serviceId]?.name ?? serviceId} often transferred`,
        why: `${n} ${SERVICE_BY_ID[serviceId]?.name ?? serviceId} customers were transferred to another counter today. Fix the intake mapping or counter skills.`,
        dedupe_key: `misroute:${serviceId}`,
      });
    }
  }

  // Low CSAT: avg < 3 in last 10 feedbacks
  if (s.recentRatings.length >= 5) {
    const avg = s.recentRatings.reduce((a, b) => a + b, 0) / s.recentRatings.length;
    if (avg < 3) {
      out.push({
        type: "LOW_CSAT",
        severity: "WARN",
        title: "Customer satisfaction dropping",
        why: `Average rating of the last ${s.recentRatings.length} feedbacks is ${avg.toFixed(1)}/5. Review the comments in Insights.`,
        dedupe_key: "csat",
      });
    }
  }
  return out;
}
