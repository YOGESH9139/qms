// Pull-based token scoring (CLAUDE.md section 7.1). Pure functions — used by the live queue engine,
// the ETA projection, and the synthetic-history replay in scripts/generate.ts.

import type { PriorityFlag, Skill } from "@/lib/types";

export const SCORE_WEIGHTS = {
  priority: 15,
  appointmentInWindow: 30,
  returning: 20,
  modeMatch: 10,
  slaBreach: 50,
} as const;

/** Appointment tokens become eligible this many minutes before their window starts. */
export const APPOINTMENT_EARLY_MIN = 10;

export interface ScoreInput {
  /** minutes since original_arrival_at */
  minutesWaited: number;
  priorityFlag: PriorityFlag;
  /** now within [appointment_start, appointment_end] */
  appointmentInWindow: boolean;
  /** returning from PARKED or TRANSFERRED */
  returning: boolean;
  serviceSkill: Skill;
  counterModeSkill: Skill | null;
  targetWaitMin: number;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

const PRIORITY_LABEL: Record<PriorityFlag, string> = {
  NONE: "",
  SENIOR: "senior citizen",
  DISABLED: "differently abled",
  PREGNANT: "pregnant",
};

export function scoreToken(i: ScoreInput): ScoreResult {
  const waited = Math.max(0, i.minutesWaited);
  let score = waited;
  const reasons = [`waited ${Math.round(waited)} min`];

  if (i.priorityFlag !== "NONE") {
    score += SCORE_WEIGHTS.priority;
    reasons.push(`priority: ${PRIORITY_LABEL[i.priorityFlag]}`);
  }
  if (i.appointmentInWindow) {
    score += SCORE_WEIGHTS.appointmentInWindow;
    reasons.push("appointment due");
  }
  if (i.returning) {
    score += SCORE_WEIGHTS.returning;
    reasons.push("returning after transfer / park");
  }
  if (i.counterModeSkill && i.serviceSkill === i.counterModeSkill) {
    score += SCORE_WEIGHTS.modeMatch;
    reasons.push("matches this counter's focus");
  }
  if (waited > i.targetWaitMin) {
    score += SCORE_WEIGHTS.slaBreach;
    reasons.push(`SLA breached (target ${i.targetWaitMin} min)`);
  }
  return { score, reasons };
}

/** Can this staff member serve this service at all? */
export function canServe(staffSkills: readonly Skill[], serviceSkill: Skill): boolean {
  return staffSkills.includes(serviceSkill);
}

/** Appointment tokens are only eligible from (start - 10 min). Walk-ins are always eligible. */
export function appointmentEligible(nowMin: number, appointmentStartMin: number | null): boolean {
  return appointmentStartMin == null || nowMin >= appointmentStartMin - APPOINTMENT_EARLY_MIN;
}
