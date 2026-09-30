// Explainable forecast (CLAUDE.md 9.1):
// expected = base_rate[dow][hour][category] × salary × month_end × post_holiday × pension + booked appointments
// base_rate is the mean of DE-FACTORED history (each day's count ÷ that day's factors), so factors aren't double counted.

import type { AreaType, Category } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

import { addDays, combinedFactor, dayFactors, dayOfWeek, isWorkingDay, type DayFactor } from "./calendar";

export interface HourlyRow {
  date: string;
  hour: number;
  category: Category;
  arrivals: number;
}

export type BaseRates = Map<string, number>; // `${dow}|${hour}|${category}` -> arrivals/hour

const key = (dow: number, hour: number, cat: Category) => `${dow}|${hour}|${cat}`;

export function baseRates(rows: HourlyRow[], areaType: AreaType, before?: string): BaseRates {
  const use = before ? rows.filter((r) => r.date < before) : rows;
  const daysByDow = new Map<number, Set<string>>();
  for (const r of use) {
    const dow = dayOfWeek(r.date);
    if (!daysByDow.has(dow)) daysByDow.set(dow, new Set());
    daysByDow.get(dow)!.add(r.date);
  }
  const sums = new Map<string, number>();
  for (const r of use) {
    const k = key(dayOfWeek(r.date), r.hour, r.category);
    const f = combinedFactor(dayFactors(r.date, r.category, areaType));
    sums.set(k, (sums.get(k) ?? 0) + r.arrivals / f);
  }
  const out: BaseRates = new Map();
  sums.forEach((v, k) => {
    const dow = Number(k.split("|")[0]);
    out.set(k, v / (daysByDow.get(dow)?.size ?? 1));
  });
  return out;
}

export interface ForecastCell {
  hour: number;
  category: Category;
  expected: number;
  explanation: {
    base: number;
    day_of_week: number;
    factors: DayFactor[];
    booked: number;
    formula: string;
  };
}

export function forecastDay(
  base: BaseRates,
  date: string,
  areaType: AreaType,
  hours: number[],
  booked: Record<string, number> = {}
): ForecastCell[] {
  if (!isWorkingDay(date)) return [];
  const dow = dayOfWeek(date);
  const out: ForecastCell[] = [];
  for (const hour of hours) {
    for (const category of CATEGORIES) {
      const b = base.get(key(dow, hour, category)) ?? 0;
      const factors = dayFactors(date, category, areaType);
      const bookedN = booked[`${hour}|${category}`] ?? 0;
      const expected = b * combinedFactor(factors) + bookedN;
      out.push({
        hour,
        category,
        expected: Math.round(expected * 10) / 10,
        explanation: {
          base: Math.round(b * 10) / 10,
          day_of_week: dow,
          factors,
          booked: bookedN,
          formula: [`base ${b.toFixed(1)}`, ...factors.map((f) => `× ${f.value} (${f.label})`), bookedN ? `+ ${bookedN} booked` : ""]
            .filter(Boolean)
            .join(" "),
        },
      });
    }
  }
  return out;
}

export interface Mape {
  hourly: number; // % error on hourly totals
  daily: number; // % error on daily totals
  days: number;
  series: { date: string; actual: number; forecast: number }[];
}

/** Backtest on the last N working days of history, trained only on earlier days. */
export function backtestMape(rows: HourlyRow[], areaType: AreaType, hours: number[], lastN = 14): Mape {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const test = dates.slice(-lastN);
  if (!test.length) return { hourly: 0, daily: 0, days: 0, series: [] };
  const base = baseRates(rows, areaType, test[0]);
  let hErr = 0;
  let hN = 0;
  let dErr = 0;
  const series: Mape["series"] = [];
  for (const d of test) {
    const fc = forecastDay(base, d, areaType, hours);
    let dayA = 0;
    let dayF = 0;
    for (const h of hours) {
      const a = rows.filter((r) => r.date === d && r.hour === h).reduce((s, r) => s + r.arrivals, 0);
      const f = fc.filter((c) => c.hour === h).reduce((s, c) => s + c.expected, 0);
      dayA += a;
      dayF += f;
      if (a > 0) {
        hErr += Math.abs(a - f) / a;
        hN++;
      }
    }
    if (dayA > 0) dErr += Math.abs(dayA - dayF) / dayA;
    series.push({ date: d, actual: dayA, forecast: Math.round(dayF) });
  }
  return {
    hourly: Math.round((1000 * hErr) / Math.max(1, hN)) / 10,
    daily: Math.round((1000 * dErr) / test.length) / 10,
    days: test.length,
    series,
  };
}

/** Next working day on or after a date. */
export function workingDayFrom(date: string): string {
  let d = date;
  while (!isWorkingDay(d)) d = addDays(d, 1);
  return d;
}
