import { describe, expect, it } from "vitest";

import { appointmentEligible, canServe, scoreToken, SCORE_WEIGHTS, type ScoreInput } from "./scoring";

const base: ScoreInput = {
  minutesWaited: 5,
  priorityFlag: "NONE",
  appointmentInWindow: false,
  returning: false,
  serviceSkill: "QUICK",
  counterModeSkill: "STANDARD",
  targetWaitMin: 10,
};

describe("scoreToken", () => {
  it("scores plain waiting time", () => {
    expect(scoreToken(base)).toEqual({ score: 5, reasons: ["waited 5 min"] });
  });

  it("adds every boost from section 7.1", () => {
    const r = scoreToken({
      ...base,
      minutesWaited: 18,
      priorityFlag: "SENIOR",
      appointmentInWindow: true,
      returning: true,
      counterModeSkill: "QUICK",
    });
    const w = SCORE_WEIGHTS;
    expect(r.score).toBe(18 + w.priority + w.appointmentInWindow + w.returning + w.modeMatch + w.slaBreach);
    expect(r.reasons).toContain("appointment due");
    expect(r.reasons).toContain("SLA breached (target 10 min)");
  });

  it("rescues SLA breaches over newer priority tokens", () => {
    const breached = scoreToken({ ...base, minutesWaited: 12 });
    const priority = scoreToken({ ...base, minutesWaited: 1, priorityFlag: "PREGNANT" });
    expect(breached.score).toBeGreaterThan(priority.score);
  });
});

describe("eligibility", () => {
  it("checks skills", () => {
    expect(canServe(["QUICK", "STANDARD"], "STANDARD")).toBe(true);
    expect(canServe(["QUICK"], "LOANS")).toBe(false);
  });

  it("holds appointments until 10 min before start", () => {
    expect(appointmentEligible(649, 660)).toBe(false);
    expect(appointmentEligible(650, 660)).toBe(true);
    expect(appointmentEligible(600, null)).toBe(true);
  });
});
