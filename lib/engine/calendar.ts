// Bank calendar + explainable day factors (CLAUDE.md section 9.1).
// Shared by the synthetic data generator (ground truth) and the forecast model (prediction),
// so the demo forecast is explainable in exactly the terms the data was built from.
// Dates are "YYYY-MM-DD" strings in branch-local time (IST); all math is done in UTC to avoid TZ drift.

import type { AreaType, Category } from "@/lib/types";
import { HOLIDAY_SET } from "@/lib/data/holidays";

export interface DayFactor {
  name: "salary_day" | "month_end" | "post_holiday" | "pension_day";
  label: string;
  value: number;
}

export const FACTOR_VALUES = {
  salary_day: 1.4,
  month_end: 1.2,
  post_holiday: 1.3,
  pension_day: 1.3,
} as const;

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDate(d);
}

/** 0 = Sunday .. 6 = Saturday */
export function dayOfWeek(date: string): number {
  return parse(date).getUTCDay();
}

export function dayOfMonth(date: string): number {
  return parse(date).getUTCDate();
}

export function isHoliday(date: string): boolean {
  return HOLIDAY_SET.has(date);
}

/** Indian banks: closed Sundays, 2nd and 4th Saturdays, and public holidays. */
export function isWorkingDay(date: string): boolean {
  const dow = dayOfWeek(date);
  if (dow === 0) return false;
  if (dow === 6) {
    const nth = Math.ceil(dayOfMonth(date) / 7);
    if (nth === 2 || nth === 4) return false;
  }
  return !isHoliday(date);
}

export function previousWorkingDay(date: string): string {
  let d = addDays(date, -1);
  while (!isWorkingDay(d)) d = addDays(d, -1);
  return d;
}

export function nextWorkingDay(date: string): string {
  let d = addDays(date, 1);
  while (!isWorkingDay(d)) d = addDays(d, 1);
  return d;
}

export function isSalaryDay(date: string): boolean {
  return dayOfMonth(date) <= 5;
}

/** Last 2 working days of the month. */
export function isMonthEnd(date: string): boolean {
  if (!isWorkingDay(date)) return false;
  const month = date.slice(0, 7);
  const next = nextWorkingDay(date);
  if (next.slice(0, 7) !== month) return true;
  return nextWorkingDay(next).slice(0, 7) !== month;
}

/** First working day after a public holiday (weekend closures in between are skipped over). */
export function isPostHoliday(date: string): boolean {
  if (!isWorkingDay(date)) return false;
  const prev = previousWorkingDay(date);
  for (let d = addDays(prev, 1); d < date; d = addDays(d, 1)) {
    if (isHoliday(d)) return true;
  }
  return false;
}

export function isPensionWindow(date: string): boolean {
  return dayOfMonth(date) <= 7;
}

/** Multipliers applied on top of the base rate for a given day + category, with reasons. */
export function dayFactors(date: string, category: Category, areaType: AreaType): DayFactor[] {
  const out: DayFactor[] = [];
  if (isSalaryDay(date)) {
    out.push({ name: "salary_day", label: "Salary days (1st–5th of month)", value: FACTOR_VALUES.salary_day });
  }
  if (isMonthEnd(date)) {
    out.push({ name: "month_end", label: "Last 2 working days of month", value: FACTOR_VALUES.month_end });
  }
  if (isPostHoliday(date)) {
    out.push({ name: "post_holiday", label: "First working day after a holiday", value: FACTOR_VALUES.post_holiday });
  }
  if (areaType === "SENIOR_HEAVY" && category === "STANDARD" && isPensionWindow(date)) {
    out.push({
      name: "pension_day",
      label: "Pension days (1st–7th) at a senior-heavy branch",
      value: FACTOR_VALUES.pension_day,
    });
  }
  return out;
}

export function combinedFactor(factors: DayFactor[]): number {
  return factors.reduce((acc, f) => acc * f.value, 1);
}

/** "HH:MM" -> minutes since midnight */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** minutes since midnight -> "HH:MM" */
export function fromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** ISO timestamp with IST offset for a local date + fractional minutes since midnight. */
export function istIso(date: string, minutes: number): string {
  const totalSec = Math.round(minutes * 60);
  const dayOffset = Math.floor(totalSec / 86400);
  const sec = totalSec - dayOffset * 86400;
  const d = dayOffset ? addDays(date, dayOffset) : date;
  const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${d}T${hh}:${mm}:${ss}+05:30`;
}
