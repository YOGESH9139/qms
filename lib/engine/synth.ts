// Synthetic ground truth shared by the data generator, the live simulator and the before/after replay.
import {
  APPOINTMENT_SHARE,
  PRIORITY_MIX,
  WALKIN_SOURCES,
  serviceWeights,
  type BranchProfile,
} from "@/lib/data/profiles";
import { combinedFactor, dayFactors, dayOfWeek, fromMinutes, isSalaryDay, toMinutes } from "@/lib/engine/calendar";
import { chance, lognormalMean, poisson, randInt, weightedPick, type Rng } from "@/lib/random";
import { CATEGORIES, type Branch, type PriorityFlag, type Staff, type TokenSource } from "@/lib/types";

import type { Arrival } from "./replay";

// ---------------------------------------------------------------- rosters

export interface RosterRow {
  branch_id: string;
  staff_id: string;
  date: string;
  shift_start: string;
  shift_end: string;
  absent: boolean;
  breaks: { start: string; minutes: number; reason: string; actual_minutes: number }[];
}

export function makeRoster(rng: Rng, s: Staff, b: Branch, date: string): RosterRow {
  const open = toMinutes(b.open_time);
  const close = toMinutes(b.close_time);
  const absent = s.role === "STAFF" && chance(rng, 0.08);
  const breaks: RosterRow["breaks"] = [];
  if (!absent && s.role === "STAFF") {
    const lunchStart = 780 + randInt(rng, 0, 90); // 13:00–14:30
    const overrun = chance(rng, 0.06) ? randInt(rng, 10, 25) : 0;
    breaks.push({ start: fromMinutes(lunchStart), minutes: 30, reason: "lunch", actual_minutes: 30 + overrun });
    if (chance(rng, 0.4)) {
      const shortStart = 690 + randInt(rng, 0, 240); // 11:30–15:30
      if (Math.abs(shortStart - lunchStart) > 45) {
        breaks.push({ start: fromMinutes(shortStart), minutes: 10, reason: "short", actual_minutes: 10 + randInt(rng, 0, 5) });
      }
    }
  }
  return {
    branch_id: b.id,
    staff_id: s.id,
    date,
    shift_start: fromMinutes(open - 30),
    shift_end: fromMinutes(close + 60),
    absent,
    breaks,
  };
}

// ---------------------------------------------------------------- arrivals

export function makeArrivals(rng: Rng, b: Branch, p: BranchProfile, date: string): Arrival[] {
  const open = toMinutes(b.open_time);
  const close = toMinutes(b.close_time);
  const curveSum = p.hourCurve.reduce((s, x) => s + x, 0);
  const dow = dayOfWeek(date);
  const out: Arrival[] = [];

  p.hourCurve.forEach((w, hi) => {
    for (const cat of CATEGORIES) {
      let lambda = ((p.dailyVolume * w) / curveSum) * p.categoryMix[cat] * p.dowFactor[dow];
      lambda *= combinedFactor(dayFactors(date, cat, b.area_type));
      if (cat === "QUICK" && p.quickStartOfMonthBoost && isSalaryDay(date)) lambda *= p.quickStartOfMonthBoost;
      const n = poisson(rng, lambda);
      const weights = serviceWeights(p, cat);
      for (let k = 0; k < n; k++) {
        const serviceId = weightedPick(rng, weights);
        let arrivalMin = open + hi * 60 + rng() * 60;
        let appointmentStartMin: number | null = null;
        let source: TokenSource;
        if (chance(rng, APPOINTMENT_SHARE[cat])) {
          const slot = Math.ceil(arrivalMin / 30) * 30;
          if (slot + 30 <= close) {
            source = "APP_APPOINTMENT";
            appointmentStartMin = slot;
            arrivalMin = chance(rng, 0.1) ? slot + rng() * 20 : slot - rng() * 15; // 10% arrive late
          } else {
            source = "APP_WALKIN";
          }
        } else {
          source = chance(rng, p.greeterShare) ? "GREETER" : weightedPick(rng, WALKIN_SOURCES);
        }
        const priority: PriorityFlag = chance(rng, p.priorityRate) ? weightedPick(rng, PRIORITY_MIX) : "NONE";
        const patient = source === "APP_APPOINTMENT" || priority !== "NONE" ? 1.5 : 1;
        out.push({
          serviceId,
          arrivalMin,
          source,
          priority,
          appointmentStartMin,
          bookedNoShow: source === "APP_APPOINTMENT" && chance(rng, 0.08),
          walkinNoShow: source !== "APP_APPOINTMENT" && chance(rng, 0.03),
          patienceMin: lognormalMean(rng, 95, 0.45) * patient,
        });
      }
    }
  });
  return out;
}

