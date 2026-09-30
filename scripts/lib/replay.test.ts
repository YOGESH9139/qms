import { describe, expect, it } from "vitest";

import { createRng } from "@/lib/random";

import { replayDay, type Arrival, type CounterStaff } from "./replay";

const walkin = (serviceId: string, arrivalMin: number, extra: Partial<Arrival> = {}): Arrival => ({
  serviceId,
  arrivalMin,
  source: "KIOSK",
  priority: "NONE",
  appointmentStartMin: null,
  bookedNoShow: false,
  walkinNoShow: false,
  patienceMin: 999,
  ...extra,
});

const counter = (skills: CounterStaff["skills"]): CounterStaff => ({
  staffId: "S1",
  counterNumber: 1,
  skills,
  modeSkill: skills[0],
  speed: 1,
  startMin: 600,
  breaks: [],
});

describe("replayDay", () => {
  it("serves everyone and records consistent timestamps", () => {
    const arrivals = [walkin("cash_deposit", 600), walkin("passbook_update", 601), walkin("cheque_deposit", 602)];
    const res = replayDay(createRng(1), arrivals, [counter(["QUICK"])], 960, 1);
    expect(res).toHaveLength(3);
    for (const v of res) {
      expect(v.status).toBe("COMPLETED");
      expect(v.calledMin!).toBeGreaterThanOrEqual(v.arrivalMin);
      expect(v.completedMin!).toBeGreaterThan(v.servingStartMin!);
    }
  });

  it("serves a priority customer ahead of an earlier walk-in", () => {
    const arrivals = [
      walkin("cash_deposit", 600),
      walkin("cash_deposit", 601),
      walkin("cash_deposit", 603, { priority: "SENIOR" }),
    ];
    const res = replayDay(createRng(2), arrivals, [counter(["QUICK"])], 960, 1);
    const order = [...res].sort((a, b) => a.calledMin! - b.calledMin!).map((v) => v.priority);
    expect(order.indexOf("SENIOR")).toBeLessThan(2);
  });

  it("never lets a counter serve a skill it lacks", () => {
    const res = replayDay(
      createRng(3),
      [walkin("loan_application", 600, { patienceMin: 30 })],
      [counter(["QUICK"])],
      660,
      1
    );
    expect(res[0].status).toBe("CANCELLED");
  });
});
