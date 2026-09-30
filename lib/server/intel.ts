import "server-only";

// Server side of the manager intelligence: data loading for forecasts, Erlang staffing, network status,
// the engine tick (alerts + recommendations) and executing accepted recommendations.

import type { SupabaseClient } from "@supabase/supabase-js";

import { effectiveNow, istDayStart, istParts } from "@/lib/clock";
import { BRANCHES, COUNTERS, STAFF, getBranch } from "@/lib/data/branches";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import { PROFILES, serviceWeights } from "@/lib/data/profiles";
import { CATEGORY_NAME, CATEGORY_SKILLS, CATEGORY_TARGET, runAlertRules, type Snapshot } from "@/lib/engine/alerts";
import { addDays, nextWorkingDay, toMinutes } from "@/lib/engine/calendar";
import { agentsNeeded, expectedWait } from "@/lib/engine/erlang";
import { backtestMape, baseRates, forecastDay, type ForecastCell, type HourlyRow } from "@/lib/engine/forecast";
import { recommend, type NearbyBranch, type RecDraft } from "@/lib/engine/recommend";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { CATEGORIES, type Category, type Skill } from "@/lib/types";

import { friendlier } from "./intake";
import { getSim, Workspace } from "./workspace";

// ---------------------------------------------------------------- history + forecast

const hourlyCache = new Map<string, HourlyRow[]>();

export async function loadHourly(db: SupabaseClient, branchId: string): Promise<HourlyRow[]> {
  const hit = hourlyCache.get(branchId);
  if (hit) return hit;
  const rows: HourlyRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("visit_hourly")
      .select("date, hour, category, arrivals")
      .eq("branch_id", branchId)
      .order("date")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data as HourlyRow[]));
    if (!data || data.length < 1000) break;
  }
  hourlyCache.set(branchId, rows);
  return rows;
}

export function branchHours(branchId: string): number[] {
  const b = getBranch(branchId)!;
  const out: number[] = [];
  for (let h = toMinutes(b.open_time) / 60; h < toMinutes(b.close_time) / 60; h++) out.push(h);
  return out;
}

/** Appointments booked per `${hour}|${category}` on a date. */
export async function bookedCounts(db: SupabaseClient, branchId: string, date: string): Promise<Record<string, number>> {
  const start = new Date(`${date}T00:00:00+05:30`).toISOString();
  const end = new Date(`${addDays(date, 1)}T00:00:00+05:30`).toISOString();
  const { data } = await db
    .from("tokens")
    .select("service_id, appointment_start")
    .eq("branch_id", branchId)
    .eq("status", "BOOKED")
    .gte("appointment_start", start)
    .lt("appointment_start", end);
  const out: Record<string, number> = {};
  for (const t of data ?? []) {
    const k = `${istParts(new Date(t.appointment_start)).hour}|${SERVICE_BY_ID[t.service_id].category}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export async function forecastFor(db: SupabaseClient, branchId: string, date: string, withBooked = true): Promise<ForecastCell[]> {
  const b = getBranch(branchId)!;
  const rows = await loadHourly(db, branchId);
  return forecastDay(baseRates(rows, b.area_type), date, b.area_type, branchHours(branchId), withBooked ? await bookedCounts(db, branchId, date) : {});
}

/** Service-mix weighted average handle time per category (learned values). */
export function categoryHandle(branchId: string, avgHandle: Record<string, number>): Record<Category, number> {
  const p = PROFILES[branchId];
  const out = {} as Record<Category, number>;
  for (const cat of CATEGORIES) {
    const w = serviceWeights(p, cat);
    const tot = Object.values(w).reduce((a, b) => a + b, 0);
    out[cat] = Object.entries(w).reduce((s, [id, x]) => s + (avgHandle[id] ?? SERVICE_BY_ID[id].avg_handle_min) * x, 0) / tot;
  }
  return out;
}

export async function rosteredStaff(db: SupabaseClient, branchId: string, date: string): Promise<{ id: string; skills: Skill[] }[]> {
  const { data } = await db.from("rosters").select("staff_id, absent").eq("branch_id", branchId).eq("date", date);
  const present = new Set((data ?? []).filter((r) => !r.absent).map((r) => r.staff_id));
  return STAFF.filter((s) => s.branch_id === branchId && s.role === "STAFF" && (present.size === 0 || present.has(s.id))).map((s) => ({ id: s.id, skills: s.skills }));
}

export interface StaffingRow {
  hour: number;
  category: Category;
  expected: number;
  needed: number;
  rostered: number;
}

export function staffingPlan(cells: ForecastCell[], handle: Record<Category, number>, rostered: { skills: Skill[] }[]): StaffingRow[] {
  return cells.map((c) => ({
    hour: c.hour,
    category: c.category,
    expected: c.expected,
    needed: agentsNeeded(c.expected, handle[c.category], CATEGORY_TARGET[c.category]).agents,
    rostered: rostered.filter((s) => s.skills.some((k) => CATEGORY_SKILLS[c.category].includes(k))).length,
  }));
}

export async function forecastReport(branchId: string) {
  const db = getSupabaseAdmin();
  const sim = await getSim(db);
  const now = effectiveNow(sim);
  const today = istParts(now).date;
  const tomorrow = nextWorkingDay(today);
  const b = getBranch(branchId)!;
  const ws = await Workspace.load(branchId, { db, now });
  const [todayCells, tomorrowCells, rows, rosterToday, rosterTomorrow] = await Promise.all([
    forecastFor(db, branchId, today),
    forecastFor(db, branchId, tomorrow),
    loadHourly(db, branchId),
    rosteredStaff(db, branchId, today),
    rosteredStaff(db, branchId, tomorrow),
  ]);
  const handle = categoryHandle(branchId, ws.ctx.avgHandle ?? {});
  const start = istDayStart(now).getTime();
  const actual: Record<string, number> = {};
  for (const t of ws.tokens) {
    const created = new Date(t.original_arrival_at ?? t.created_at);
    if (created.getTime() < start || t.source === "APP_APPOINTMENT" && t.status === "BOOKED") continue;
    const k = `${istParts(created).hour}|${SERVICE_BY_ID[t.service_id].category}`;
    actual[k] = (actual[k] ?? 0) + 1;
  }
  return {
    today,
    tomorrow,
    nowHour: istParts(now).hour,
    cells: todayCells.map((c) => ({ ...c, actual: istParts(now).hour >= c.hour ? (actual[`${c.hour}|${c.category}`] ?? 0) : null })),
    tomorrowCells,
    staffingToday: staffingPlan(todayCells, handle, rosterToday),
    staffingTomorrow: staffingPlan(tomorrowCells, handle, rosterTomorrow),
    handle,
    mape: backtestMape(rows, b.area_type, branchHours(branchId)),
  };
}

// ---------------------------------------------------------------- network

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export interface BranchStatus {
  id: string;
  name: string;
  area_type: string;
  lat: number;
  lng: number;
  waitMin: number;
  live: boolean;
  waiting: number;
  peakHour: number | null;
  peakExpected: number;
  staffGap: number;
  rostered: number;
  csat: number | null;
}

export async function networkStatus(): Promise<{ branches: BranchStatus[]; lending: RecDraftWithBranch[]; now: string }> {
  const db = getSupabaseAdmin();
  const sim = await getSim(db);
  const now = effectiveNow(sim);
  const today = istParts(now).date;
  const hour = istParts(now).hour;
  const since = addDays(today, -14);
  const [{ data: waiting }, { data: csat }, { data: counters }] = await Promise.all([
    db.from("tokens").select("branch_id, eta_minutes").eq("status", "WAITING").gte("created_at", istDayStart(now).toISOString()),
    db.from("feedback_daily").select("branch_id, csat, n").gte("date", since),
    db.from("counters").select("branch_id, staff_id, status"),
  ]);

  const statuses: BranchStatus[] = [];
  const plans: Record<string, StaffingRow[]> = {};
  for (const b of BRANCHES) {
    const [cells, roster] = await Promise.all([forecastFor(db, b.id, today, false), rosteredStaff(db, b.id, today)]);
    const handle = categoryHandle(b.id, {});
    plans[b.id] = staffingPlan(cells, handle, roster);
    const w = (waiting ?? []).filter((t) => t.branch_id === b.id);
    const byHour = new Map<number, number>();
    cells.forEach((c) => byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + c.expected));
    const peak = [...byHour.entries()].sort((a, b2) => b2[1] - a[1])[0];
    // pooled Erlang C on all arrivals (staff are multi-skilled, so per-category needs would double count)
    const pooledHandle = handle.QUICK * 0.6 + handle.STANDARD * 0.25 + handle.COMPLEX * 0.15;
    const gap = peak ? agentsNeeded(peak[1], pooledHandle, 15).agents - roster.length : 0;
    let waitMin: number;
    const live = w.length > 0 || (counters ?? []).some((c) => c.branch_id === b.id && c.status !== "OFFLINE");
    if (w.length) waitMin = Math.max(...w.map((t) => t.eta_minutes ?? 0));
    else {
      const lam = byHour.get(hour) ?? 0;
      waitMin = expectedWait(roster.length, lam, pooledHandle);
    }
    const c = (csat ?? []).filter((r) => r.branch_id === b.id);
    const n = c.reduce((s, r) => s + r.n, 0);
    statuses.push({
      id: b.id, name: b.name, area_type: b.area_type, lat: b.lat, lng: b.lng,
      waitMin: Math.round(waitMin), live, waiting: w.length,
      peakHour: peak?.[0] ?? null, peakExpected: Math.round(peak?.[1] ?? 0), staffGap: gap, rostered: roster.length,
      csat: n ? Math.round((c.reduce((s, r) => s + Number(r.csat) * r.n, 0) / n) * 100) / 100 : null,
    });
  }

  // Staff lending: branch with a peak gap borrows a multi-skilled person from the nearest branch with slack.
  const lending: RecDraftWithBranch[] = [];
  for (const need of statuses.filter((s) => s.staffGap > 0).sort((a, b) => b.staffGap - a.staffGap)) {
    const donors = statuses
      .filter((s) => s.id !== need.id && s.staffGap <= -1)
      .sort((a, b) => distanceKm(a, need) - distanceKm(b, need));
    const donor = donors[0];
    if (!donor) continue;
    const person = STAFF.filter((s) => s.branch_id === donor.id && s.role === "STAFF" && s.skills.length >= 2).sort((a, b) => b.skills.length - a.skills.length)[0];
    if (!person) continue;
    lending.push({
      branch_id: need.id,
      type: "STAFF_LENDING",
      title: `Lend ${person.name} from ${donor.name.replace("Sample Demo Bank — ", "")} to ${need.name.replace("Sample Demo Bank — ", "")} today`,
      explanation: `${need.name.replace("Sample Demo Bank — ", "")} needs ${need.staffGap} more counter(s) at its ${need.peakHour}:00 peak (~${need.peakExpected} arrivals/h, Erlang C) while ${donor.name.replace("Sample Demo Bank — ", "")} has ${-donor.staffGap} spare. ${person.name} (${person.skills.join(", ").toLowerCase()}) is ${distanceKm(donor, need).toFixed(1)} km away.`,
      impact: { note: `Closes ${Math.min(need.staffGap, 1)} of ${need.staffGap} counter gap at peak`, affected: 1 },
      action: { key: `lend:${person.id}:${need.id}`, staff_id: person.id, from: donor.id, to: need.id },
    });
  }
  return { branches: statuses, lending, now: now.toISOString() };
}

export type RecDraftWithBranch = RecDraft & { branch_id: string };

export async function nearbyFor(branchId: string, net?: BranchStatus[]): Promise<NearbyBranch[]> {
  const here = getBranch(branchId)!;
  const list = net ?? (await networkStatus()).branches;
  return list.filter((b) => b.id !== branchId).map((b) => ({ id: b.id, name: b.name, waitMin: b.waitMin, distanceKm: distanceKm(here, b) }));
}

// ---------------------------------------------------------------- engine tick: alerts + recommendations

const nearbyCache = new Map<string, { at: number; list: NearbyBranch[] }>();

export async function buildSnapshot(ws: Workspace): Promise<Snapshot> {
  const db = ws.db;
  const now = ws.now;
  const today = istParts(now).date;
  const hourNow = istParts(now).hour;
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const dayStart = istDayStart(now).toISOString();
  const [cells, events, ratings] = await Promise.all([
    forecastFor(db, ws.branchId, today),
    db.from("token_events").select("type, meta, at").eq("branch_id", ws.branchId).gte("at", dayStart).in("type", ["TRANSFER", "CALL", "NO_SHOW"]),
    db.from("feedback").select("rating").eq("branch_id", ws.branchId).not("token_id", "is", null).order("at", { ascending: false }).limit(10),
  ]);
  const handle = categoryHandle(ws.branchId, ws.ctx.avgHandle ?? {});
  const online = ws.counters.filter((c) => c.status !== "OFFLINE" && c.staff_id);
  const gaps = cells
    .filter((c) => c.hour >= hourNow && c.hour < hourNow + 2)
    .map((c) => ({
      hour: c.hour,
      category: c.category,
      needed: agentsNeeded(c.expected, handle[c.category], CATEGORY_TARGET[c.category]).agents,
      available: online.filter((k) => (ws.staffSkills[k.staff_id!] ?? []).some((s) => CATEGORY_SKILLS[c.category].includes(s))).length,
    }));
  const ev = events.data ?? [];
  const transfersToday: Record<string, number> = {};
  for (const e of ev.filter((x) => x.type === "TRANSFER")) {
    const from = (e.meta as { from_service_id?: string } | null)?.from_service_id;
    if (from) transfersToday[from] = (transfersToday[from] ?? 0) + 1;
  }
  const recent = ev.filter((e) => e.at >= hourAgo);
  return {
    ctx: ws.ctx,
    tokens: ws.tokens,
    counters: ws.counters,
    staff: ws.staff,
    staffSkills: ws.staffSkills,
    waitByCategory: ws.waitByCategory(),
    gaps,
    recentRatings: (ratings.data ?? []).map((r) => r.rating),
    transfersToday,
    callsLastHour: recent.filter((e) => e.type === "CALL").length,
    noShowsLastHour: recent.filter((e) => e.type === "NO_SHOW").length,
  };
}

/** Runs alert rules + recommendation generation and syncs them to the DB (dedupe, auto-resolve). */
export async function engineTick(ws: Workspace): Promise<{ alerts: number; recs: number }> {
  const db = ws.db;
  const now = ws.now.toISOString();
  ws.recomputeEtas();
  const snap = await buildSnapshot(ws);

  // alerts
  const drafts = runAlertRules(snap);
  const { data: open } = await db.from("alerts").select("*").eq("branch_id", ws.branchId).eq("status", "OPEN");
  const openByKey = new Map((open ?? []).map((a) => [a.dedupe_key, a]));
  const keys = new Set(drafts.map((d) => d.dedupe_key));
  const inserts = drafts.filter((d) => !openByKey.has(d.dedupe_key)).map((d) => ({ ...d, branch_id: ws.branchId, status: "OPEN", at: now }));
  const updates = drafts.filter((d) => openByKey.has(d.dedupe_key) && openByKey.get(d.dedupe_key)!.why !== d.why);
  const resolve = (open ?? []).filter((a) => a.type !== "ESCALATION" && !keys.has(a.dedupe_key)).map((a) => a.id);
  await Promise.all([
    inserts.length ? db.from("alerts").insert(inserts) : null,
    ...updates.map((d) => db.from("alerts").update({ why: d.why, severity: d.severity }).eq("id", openByKey.get(d.dedupe_key)!.id)),
    resolve.length ? db.from("alerts").update({ status: "RESOLVED" }).in("id", resolve) : null,
  ]);

  // recommendations
  let nearby = nearbyCache.get(ws.branchId);
  if (!nearby || Date.now() - nearby.at > 30_000) {
    nearby = { at: Date.now(), list: await nearbyFor(ws.branchId).catch(() => []) };
    nearbyCache.set(ws.branchId, nearby);
  }
  const recs = recommend(snap, nearby.list);
  const { data: openRecs } = await db.from("recommendations").select("*").eq("branch_id", ws.branchId).eq("status", "OPEN");
  const recByKey = new Map((openRecs ?? []).map((r) => [(r.action as { key: string }).key, r]));
  const recKeys = new Set(recs.map((r) => r.action.key));
  const newRecs = recs.filter((r) => !recByKey.has(r.action.key));
  const expired = (openRecs ?? []).filter(
    (r) => r.type !== "STAFF_LENDING" && !recKeys.has((r.action as { key: string }).key) && ws.now.getTime() - new Date(r.at).getTime() > 3 * 60000
  );
  const { data: inserted } = newRecs.length
    ? await db
        .from("recommendations")
        .insert(newRecs.map((r) => ({ branch_id: ws.branchId, type: r.type, title: r.title, explanation: r.explanation, impact: r.impact, action: { ...r.action, why_raw: r.explanation }, status: "OPEN", at: now })))
        .select("id, explanation, impact")
    : { data: [] };
  await Promise.all([
    ...recs
      .filter((r) => recByKey.has(r.action.key))
      .map((r) => {
        const prev = recByKey.get(r.action.key)!;
        const rawChanged = (prev.action as { why_raw?: string }).why_raw !== r.explanation;
        const patch = rawChanged
          ? { title: r.title, impact: r.impact, explanation: r.explanation, action: { ...r.action, why_raw: r.explanation } }
          : { title: r.title, impact: r.impact, action: { ...r.action, why_raw: r.explanation } };
        return db.from("recommendations").update(patch).eq("id", prev.id);
      }),
    expired.length
      ? db.from("recommendations").update({ status: "DISMISSED", resolved_at: now, impact: { note: "Expired — condition cleared", expired: true } }).in("id", expired.map((r) => r.id))
      : null,
  ]);
  // LLM may only rephrase — fire and forget; rule text stays if it fails or changes numbers.
  for (const r of inserted ?? []) {
    friendlier(r.explanation).then((text) => {
      if (text !== r.explanation) db.from("recommendations").update({ explanation: text }).eq("id", r.id).then(() => undefined);
    });
  }
  return { alerts: drafts.length, recs: recs.length };
}

// ---------------------------------------------------------------- accept / dismiss

export async function decideRecommendation(id: string, decision: "ACCEPT" | "DISMISS") {
  const db = getSupabaseAdmin();
  const { data: rec, error } = await db.from("recommendations").select("*").eq("id", id).single();
  if (error || !rec) throw new Error("Recommendation not found");
  if (rec.status !== "OPEN") return { status: rec.status };
  const a = rec.action as Record<string, unknown>;
  const sim = await getSim(db);
  const now = effectiveNow(sim).toISOString();
  if (decision === "DISMISS") {
    await db.from("recommendations").update({ status: "DISMISSED", resolved_at: now }).eq("id", id);
    return { status: "DISMISSED" };
  }

  let result = "";
  if (rec.type === "STAFF_LENDING") {
    const staffId = a.staff_id as string;
    const to = a.to as string;
    const spare = COUNTERS.find((c) => c.branch_id === to && !c.staff_id)!;
    await db.from("counters").update({ staff_id: null, status: "OFFLINE" }).eq("staff_id", staffId);
    await db.from("staff").update({ branch_id: to }).eq("id", staffId);
    const skills = STAFF.find((s) => s.id === staffId)!.skills;
    await db.from("counters").update({ staff_id: staffId, status: "AVAILABLE", mode_skill: skills[0], status_since: now }).eq("id", spare.id);
    result = `${STAFF.find((s) => s.id === staffId)!.name} is now on Counter ${spare.number} at ${to}.`;
  } else {
    const ws = await Workspace.load(rec.branch_id, { db });
    switch (rec.type) {
      case "OPEN_COUNTER": {
        const c = ws.counter(a.counter_id as string);
        ws.putCounter({ ...c, status: "AVAILABLE", mode_skill: a.mode_skill as Skill, status_since: now, human_control: false } as typeof c, "ONLINE", "Manager accepted recommendation");
        result = `Counter ${c.number} is open.`;
        break;
      }
      case "SWITCH_FOCUS": {
        const c = ws.counter(a.counter_id as string);
        ws.putCounter({ ...c, mode_skill: a.mode_skill as Skill }, "MODE_CHANGE", "Manager accepted recommendation", { from: c.mode_skill, to: a.mode_skill });
        result = `Counter ${c.number} now focuses on ${CATEGORY_NAME[(Object.keys(CATEGORY_SKILLS) as Category[]).find((k) => CATEGORY_SKILLS[k].includes(a.mode_skill as Skill))!]}.`;
        break;
      }
      case "DIGITAL_NUDGE": {
        const ids = (a.token_ids as string[]) ?? [];
        for (const t of ws.tokens.filter((x) => ids.includes(x.id) && x.status === "WAITING")) {
          const s = SERVICE_BY_ID[t.service_id];
          ws.sms(t, `Sample Demo Bank: your ${s.name.toLowerCase()} takes about ${s.digital_minutes} min in the app (${s.digital_channel}). Prefer that? ${s.digital_link} — or keep your token ${t.code}, your place is safe.`);
          ws.note(t.id, "DIGITAL_NUDGE", null);
        }
        result = `SMS sent to ${ids.length} customers.`;
        break;
      }
      case "TIME_SHIFT_APPOINTMENTS": {
        const ids = (a.token_ids as string[]) ?? [];
        for (const t of ws.tokens.filter((x) => ids.includes(x.id))) {
          ws.sms(t, `Sample Demo Bank: the branch is busy around your appointment (${t.code}). Reply 1 to move to a quieter slot after 15:00, or keep your booking.`);
          ws.note(t.id, "TIME_SHIFT_OFFER", null);
        }
        result = `Offers sent to ${ids.length} customers.`;
        break;
      }
      case "BRANCH_REDIRECT": {
        await db.from("branch_settings").upsert({ branch_id: rec.branch_id, redirect_to: a.redirect_to, redirect_message: a.message, updated_at: now });
        result = "Redirect banner is live on the kiosk and customer app.";
        break;
      }
    }
    await ws.flush();
  }
  await db.from("recommendations").update({ status: "ACCEPTED", resolved_at: now, impact: { ...(rec.impact as object), result } }).eq("id", id);
  return { status: "ACCEPTED", result };
}

export async function storeLending(drafts: RecDraftWithBranch[]) {
  const db = getSupabaseAdmin();
  const { data: open } = await db.from("recommendations").select("action, status").eq("type", "STAFF_LENDING");
  const existing = new Set((open ?? []).map((r) => (r.action as { key: string }).key));
  const fresh = drafts.filter((d) => !existing.has(d.action.key));
  if (fresh.length) {
    await db.from("recommendations").insert(fresh.map((d) => ({ ...d, status: "OPEN" })));
  }
  const { data } = await db.from("recommendations").select("*").eq("type", "STAFF_LENDING").order("at", { ascending: false }).limit(10);
  return data ?? [];
}
