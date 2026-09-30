import { describe, expect, it } from "vitest";

import {
  combinedFactor,
  dayFactors,
  isMonthEnd,
  isPostHoliday,
  isWorkingDay,
  istIso,
  nextWorkingDay,
} from "./calendar";

describe("bank calendar", () => {
  it("closes Sundays, 2nd/4th Saturdays and holidays", () => {
    expect(isWorkingDay("2026-09-06")).toBe(false); // Sunday
    expect(isWorkingDay("2026-09-12")).toBe(false); // 2nd Saturday
    expect(isWorkingDay("2026-09-19")).toBe(true); // 3rd Saturday
    expect(isWorkingDay("2026-09-26")).toBe(false); // 4th Saturday
    expect(isWorkingDay("2026-10-02")).toBe(false); // Gandhi Jayanti
    expect(isWorkingDay("2026-09-30")).toBe(true);
  });

  it("finds the last 2 working days of the month", () => {
    expect(isMonthEnd("2026-09-30")).toBe(true);
    expect(isMonthEnd("2026-09-29")).toBe(true);
    expect(isMonthEnd("2026-09-28")).toBe(false);
  });

  it("marks the first working day after a holiday, skipping weekends", () => {
    expect(nextWorkingDay("2026-10-02")).toBe("2026-10-03");
    expect(isPostHoliday("2026-10-03")).toBe(true);
    expect(isPostHoliday("2026-09-15")).toBe(true); // after Ganesh Chaturthi (Mon 14th)
    expect(isPostHoliday("2026-09-16")).toBe(false);
    expect(isPostHoliday("2026-09-05")).toBe(true); // Janmashtami Fri 4th -> Sat 5th (1st Saturday, open)
    expect(isPostHoliday("2026-08-17")).toBe(true); // Independence Day Sat 15th, Sun 16th closed -> Mon 17th
  });
});

describe("dayFactors", () => {
  it("stacks salary day and pension day for STANDARD at a senior-heavy branch", () => {
    const f = dayFactors("2026-10-05", "STANDARD", "SENIOR_HEAVY");
    expect(f.map((x) => x.name)).toEqual(["salary_day", "pension_day"]);
    expect(combinedFactor(f)).toBeCloseTo(1.4 * 1.3);
  });

  it("does not apply pension factor elsewhere", () => {
    expect(dayFactors("2026-10-06", "STANDARD", "URBAN_BUSINESS").map((x) => x.name)).toEqual([]);
  });
});

describe("istIso", () => {
  it("formats IST timestamps including overflow past midnight", () => {
    expect(istIso("2026-09-30", 600.5)).toBe("2026-09-30T10:00:30+05:30");
    expect(istIso("2026-09-30", 1440 + 30)).toBe("2026-10-01T00:30:00+05:30");
  });
});
