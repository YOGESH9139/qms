import { describe, expect, it } from "vitest";

import { agentsNeeded, erlangC, serviceLevel } from "./erlang";
import { baseRates, forecastDay } from "./forecast";

describe("Erlang C", () => {
  it("matches the textbook value (A=2, N=3 -> C≈0.444)", () => {
    expect(erlangC(3, 2)).toBeCloseTo(0.4444, 3);
    expect(erlangC(2, 2)).toBe(1);
  });

  it("finds the minimum agents for an 80% service level", () => {
    // 30 customers/h, 10 min each = 5 Erlangs
    const need = agentsNeeded(30, 10, 15);
    expect(need.load).toBe(5);
    expect(need.serviceLevel).toBeGreaterThanOrEqual(0.8);
    expect(serviceLevel(need.agents - 1, 30, 10, 15)).toBeLessThan(0.8);
  });

  it("needs nobody for no demand", () => {
    expect(agentsNeeded(0, 5, 10).agents).toBe(0);
  });
});

describe("forecast factors", () => {
  // Two Mondays of history: a plain one (10/h) and a salary day (14/h = 10 × 1.4)
  const rows = [
    { date: "2026-09-14", hour: 10, category: "QUICK" as const, arrivals: 10 }, // Ganesh Chaturthi is a holiday — ignored below
    { date: "2026-09-21", hour: 10, category: "QUICK" as const, arrivals: 10 },
    { date: "2026-10-05", hour: 10, category: "QUICK" as const, arrivals: 14 },
  ].filter((r) => r.date !== "2026-09-14");

  it("de-factors history so salary days don't inflate the base", () => {
    const base = baseRates(rows, "URBAN_BUSINESS");
    expect(base.get("1|10|QUICK")).toBeCloseTo(10);
  });

  it("applies salary and pension factors with an explanation", () => {
    const base = new Map([["1|10|STANDARD", 10]]);
    const [cell] = forecastDay(base, "2026-10-05", "SENIOR_HEAVY", [10], { "10|STANDARD": 2 }).filter(
      (c) => c.category === "STANDARD"
    );
    expect(cell.expected).toBeCloseTo(10 * 1.4 * 1.3 + 2, 1);
    expect(cell.explanation.factors.map((f) => f.name)).toEqual(["salary_day", "pension_day"]);
    expect(cell.explanation.booked).toBe(2);
  });

  it("forecasts nothing on a bank holiday", () => {
    expect(forecastDay(new Map(), "2026-10-02", "URBAN_BUSINESS", [10])).toEqual([]);
  });
});
