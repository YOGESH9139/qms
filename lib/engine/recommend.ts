// Recommendations (CLAUDE.md 9.4). Impact is ALWAYS computed by re-running the ETA projection with the action
// applied (what-if) — never guessed. Pure.

import { SERVICE_BY_ID } from "@/lib/data/catalog";
import type { Category, Counter, Recommendation, Skill, Token } from "@/lib/types";

import { CATEGORY_NAME, CATEGORY_SKILLS, CATEGORY_TARGET, categoryOf, coverageText, staffName, type Snapshot } from "./alerts";
import { projectEtas } from "./queue";

export interface RecDraft {
  type: Recommendation["type"];
  title: string;
  explanation: string;
  impact: { category?: Category; before?: number; after?: number; metric?: string; affected?: number; note?: string };
  action: Record<string, unknown> & { key: string };
}

export interface NearbyBranch {
  id: string;
  name: string;
  waitMin: number;
  distanceKm: number;
}

/** Projected wait for a new arrival per category = max ETA of waiting tokens in that category. */
export function projectedWaits(tokens: Token[], counters: Counter[], s: Snapshot): Record<Category, number> {
  const etas = projectEtas(tokens, counters, s.staffSkills, s.ctx);
  const out: Record<Category, number> = { QUICK: 0, STANDARD: 0, COMPLEX: 0 };
  for (const t of tokens) {
    const e = etas.get(t.id)?.eta_minutes;
    if (t.status === "WAITING" && e != null) out[categoryOf(t)] = Math.max(out[categoryOf(t)], e);
  }
  return out;
}

export function recommend(s: Snapshot, nearby: NearbyBranch[] = []): RecDraft[] {
  const out: RecDraft[] = [];
  const base = projectedWaits(s.tokens, s.counters, s);

  for (const cat of ["QUICK", "STANDARD", "COMPLEX"] as Category[]) {
    const target = CATEGORY_TARGET[cat];
    const before = base[cat];
    if (before <= target) continue;
    const skills = CATEGORY_SKILLS[cat];
    const waiting = s.tokens.filter((t) => t.status === "WAITING" && categoryOf(t) === cat);
    const situation = `${CATEGORY_NAME[cat]} queue: ${waiting.length} waiting, projected ${Math.round(before)} min vs ${target} min target.`;
    const hasSkill = (c: Counter) => c.staff_id != null && (s.staffSkills[c.staff_id] ?? []).some((k) => skills.includes(k));
    const focusSkill = (c: Counter): Skill => (s.staffSkills[c.staff_id!] ?? []).find((k) => skills.includes(k))!;

    // 1. Open extra counter: offline rostered staff with the skill
    for (const c of s.counters.filter((c) => c.status === "OFFLINE" && hasSkill(c))) {
      const whatIf = s.counters.map((x) => (x.id === c.id ? { ...x, status: "AVAILABLE" as const, mode_skill: focusSkill(c) } : x));
      const after = projectedWaits(s.tokens, whatIf, s)[cat];
      if (after < before - 1) {
        out.push({
          type: "OPEN_COUNTER",
          title: `Open Counter ${c.number} (${staffName(s, c.staff_id)}) for ${CATEGORY_NAME[cat]}`,
          explanation: `${situation} ${staffName(s, c.staff_id)} is skilled for ${CATEGORY_NAME[cat]} but Counter ${c.number} is offline. Opening it brings the projected wait to ${Math.round(after)} min.`,
          impact: { category: cat, before: Math.round(before), after: Math.round(after), metric: "projected wait (min)" },
          action: { key: `open:${c.id}:${cat}`, counter_id: c.id, mode_skill: focusSkill(c) },
        });
        break;
      }
    }

    // 2. Switch focus of a multi-skilled online counter whose own category is under target
    for (const c of s.counters.filter((c) => (c.status === "AVAILABLE" || c.status === "SERVING") && hasSkill(c) && !skills.includes(c.mode_skill as Skill))) {
      const fromCat = (Object.keys(CATEGORY_SKILLS) as Category[]).find((k) => CATEGORY_SKILLS[k].includes(c.mode_skill as Skill));
      if (fromCat && base[fromCat] > CATEGORY_TARGET[fromCat]) continue; // don't rob another overloaded queue
      const whatIf = s.counters.map((x) => (x.id === c.id ? { ...x, mode_skill: focusSkill(c) } : x));
      const w = projectedWaits(s.tokens, whatIf, s);
      if (w[cat] < before - 1) {
        out.push({
          type: "SWITCH_FOCUS",
          title: `Switch Counter ${c.number} to ${CATEGORY_NAME[cat]}`,
          explanation: `${situation} ${coverageText(s, cat)} Switching ${staffName(s, c.staff_id)}'s focus brings ${CATEGORY_NAME[cat]} to ${Math.round(w[cat])} min${fromCat ? ` while ${CATEGORY_NAME[fromCat]} goes ${Math.round(base[fromCat])} → ${Math.round(w[fromCat])} min` : ""}.`,
          impact: { category: cat, before: Math.round(before), after: Math.round(w[cat]), metric: "projected wait (min)", note: fromCat ? `${CATEGORY_NAME[fromCat]} ${Math.round(base[fromCat])} → ${Math.round(w[fromCat])} min` : undefined },
          action: { key: `focus:${c.id}:${focusSkill(c)}`, counter_id: c.id, mode_skill: focusSkill(c) },
        });
        break;
      }
    }

    // 3. Digital nudge: waiting customers whose service is fully doable online (assume 30% take it)
    const nudgeable = waiting.filter((t) => SERVICE_BY_ID[t.service_id].digital_level === "FULL" && t.mobile_masked);
    if (nudgeable.length >= 2) {
      const takers = new Set(nudgeable.slice(-Math.max(1, Math.round(nudgeable.length * 0.3))).map((t) => t.id));
      const after = projectedWaits(s.tokens.filter((t) => !takers.has(t.id)), s.counters, s)[cat];
      out.push({
        type: "DIGITAL_NUDGE",
        title: `SMS ${nudgeable.length} ${CATEGORY_NAME[cat]} customers an online option`,
        explanation: `${situation} ${nudgeable.length} waiting customers came for services they can finish in the app in 2–3 minutes. If 30% take it, the projected wait drops to ${Math.round(after)} min. They keep their token either way.`,
        impact: { category: cat, before: Math.round(before), after: Math.round(after), metric: "projected wait (min), 30% uptake", affected: nudgeable.length },
        action: { key: `nudge:${cat}`, token_ids: nudgeable.map((t) => t.id) },
      });
    }

    // 4. Time-shift upcoming appointments in the overloaded category
    const soon = s.tokens.filter(
      (t) =>
        t.status === "BOOKED" &&
        categoryOf(t) === cat &&
        t.appointment_start &&
        new Date(t.appointment_start).getTime() - s.ctx.now.getTime() < 90 * 60000 &&
        new Date(t.appointment_start).getTime() > s.ctx.now.getTime()
    );
    if (soon.length) {
      out.push({
        type: "TIME_SHIFT_APPOINTMENTS",
        title: `Offer ${soon.length} upcoming ${CATEGORY_NAME[cat]} appointments a quieter slot`,
        explanation: `${situation} ${soon.length} customers are booked in the next 90 minutes. Offering them a later, quieter slot (they can keep theirs) avoids adding to the peak.`,
        impact: { category: cat, before: Math.round(before), affected: soon.length, metric: "appointments offered a quieter slot" },
        action: { key: `shift:${cat}`, token_ids: soon.map((t) => t.id) },
      });
    }

    // 5. Redirect new arrivals to a nearby branch with a much lower wait
    const alt = nearby.filter((b) => b.waitMin < before / 2 && b.distanceKm < 25).sort((a, b) => a.waitMin - b.waitMin)[0];
    if (alt && before > 2 * target) {
      out.push({
        type: "BRANCH_REDIRECT",
        title: `Suggest ${alt.name.replace("Sample Demo Bank — ", "")} to new arrivals`,
        explanation: `${situation} ${alt.name.replace("Sample Demo Bank — ", "")} is ${alt.distanceKm.toFixed(1)} km away with ~${Math.round(alt.waitMin)} min wait. Show a banner on the kiosk and app.`,
        impact: { category: cat, before: Math.round(before), after: Math.round(alt.waitMin), metric: "wait for redirected new arrivals (min)" },
        action: { key: `redirect:${alt.id}`, redirect_to: alt.id, message: `Busy here right now — ${alt.name.replace("Sample Demo Bank — ", "")} (${alt.distanceKm.toFixed(1)} km) has ~${Math.round(alt.waitMin)} min wait.` },
      });
    }
  }
  return out;
}
