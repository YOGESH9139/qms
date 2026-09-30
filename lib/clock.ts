// Simulated clock shared by server and client. All screens run on sim time so the simulator can fast-forward.
// effective now = sim_now + (real elapsed since updated_at) × speed   (frozen while paused)

export interface SimState {
  id?: number;
  sim_now: string;
  speed: number;
  running: boolean;
  mode?: "BRANCHFLOW" | "FIFO";
  updated_at: string;
  branch_id?: string | null;
  last_tick?: string | null;
  scenario?: Scenario;
}

export interface Scenario {
  surge?: { until: string; factor: number };
  outage?: { counter_id: string; until: string };
  unplanned_break?: { counter_id: string; actual_end: string };
}

export function effectiveNow(s: SimState | null | undefined, realMs = Date.now()): Date {
  if (!s) return new Date(realMs);
  const base = new Date(s.sim_now).getTime();
  if (!s.running || !s.speed) return new Date(base);
  const elapsed = Math.max(0, realMs - new Date(s.updated_at).getTime());
  return new Date(base + elapsed * s.speed);
}

const IST_MS = 5.5 * 3600_000;

/** IST calendar date, minutes since midnight, and hour for an instant. */
export function istParts(d: Date): { date: string; minutes: number; hour: number } {
  const shifted = new Date(d.getTime() + IST_MS);
  const date = shifted.toISOString().slice(0, 10);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes() + shifted.getUTCSeconds() / 60;
  return { date, minutes, hour: shifted.getUTCHours() };
}

/** Instant for an IST date + minutes since midnight. */
export function fromIst(date: string, minutes: number): Date {
  return new Date(new Date(`${date}T00:00:00+05:30`).getTime() + minutes * 60000);
}

export function istDayStart(d: Date): Date {
  return fromIst(istParts(d).date, 0);
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const { minutes } = istParts(typeof d === "string" ? new Date(d) : d);
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtDate(date: string): string {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
