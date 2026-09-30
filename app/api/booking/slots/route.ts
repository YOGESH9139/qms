import { effectiveNow, istParts } from "@/lib/clock";
import { getBranch } from "@/lib/data/branches";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import { addDays, isWorkingDay, toMinutes } from "@/lib/engine/calendar";
import { handle } from "@/lib/server/api";
import { categoryHandle, forecastFor, rosteredStaff } from "@/lib/server/intel";
import { getSim } from "@/lib/server/workspace";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const APPT_CAPACITY = 4; // appointments per 30-min slot

/** 30-min slot grid for a branch/date: crowd level from forecast vs capacity, remaining appointment capacity. */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const branchId = url.searchParams.get("branch") ?? "BR01";
    const db = getSupabaseAdmin();
    const now = effectiveNow(await getSim(db));
    const today = istParts(now).date;
    const date = url.searchParams.get("date") ?? today;
    const b = getBranch(branchId)!;

    const days: string[] = [];
    for (let d = today; days.length < 6; d = addDays(d, 1)) if (isWorkingDay(d)) days.push(d);
    if (!isWorkingDay(date)) return { date, days, slots: [], bestHour: null };

    const [cells, roster, { data: booked }] = await Promise.all([
      forecastFor(db, branchId, date),
      rosteredStaff(db, branchId, date),
      db.from("tokens").select("appointment_start, service_id").eq("branch_id", branchId).in("status", ["BOOKED", "WAITING", "CALLED", "SERVING", "COMPLETED"])
        .gte("appointment_start", new Date(`${date}T00:00:00+05:30`).toISOString())
        .lt("appointment_start", new Date(`${addDays(date, 1)}T00:00:00+05:30`).toISOString()),
    ]);
    const handle = categoryHandle(branchId, {});
    const avgHandle = handle.QUICK * 0.55 + handle.STANDARD * 0.3 + handle.COMPLEX * 0.15;
    const capacityPerHour = Math.max(1, roster.length) * (60 / avgHandle) * 0.85;

    const slots = [];
    for (let m = toMinutes(b.open_time); m + 30 <= toMinutes(b.close_time); m += 30) {
      const hour = Math.floor(m / 60);
      const expected = cells.filter((c) => c.hour === hour).reduce((s, c) => s + c.expected, 0);
      const load = expected / capacityPerHour;
      const bookedHere = (booked ?? []).filter((t) => Math.abs(istParts(new Date(t.appointment_start)).minutes - m) < 1).length;
      const past = date === today && m <= istParts(now).minutes + 15;
      slots.push({
        startMin: m,
        label: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}–${String(Math.floor((m + 30) / 60)).padStart(2, "0")}:${String((m + 30) % 60).padStart(2, "0")}`,
        level: load < 0.65 ? "GREEN" : load < 0.9 ? "AMBER" : "RED",
        load: Math.round(load * 100),
        remaining: Math.max(0, APPT_CAPACITY - bookedHere),
        disabled: past || bookedHere >= APPT_CAPACITY,
        best: false,
      });
    }
    const open = slots.filter((s) => !s.disabled);
    const best = open.sort((a, b2) => a.load - b2.load)[0];
    if (best) best.best = true;
    slots.sort((a, b2) => a.startMin - b2.startMin);
    return { date, days, slots, bestHour: best ? best.label : null, services: Object.keys(SERVICE_BY_ID).length };
  });
}
