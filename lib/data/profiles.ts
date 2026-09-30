// Branch demand profiles (CLAUDE.md section 10). Ground truth for the synthetic generator;
// the live simulator reuses the service mix to draw walk-ins.

import type { Category, PriorityFlag, TokenSource } from "@/lib/types";

export interface BranchProfile {
  /** Expected arrivals on a plain weekday (dow factor 1.0, no day factors). */
  dailyVolume: number;
  /** Relative arrival weight per opening hour, starting at open_time. */
  hourCurve: number[];
  categoryMix: Record<Category, number>;
  /** Day-of-week multipliers, index 0 = Sunday. Market day for the semi-urban branch lives here. */
  dowFactor: number[];
  /** Multipliers on DEFAULT_SERVICE_WEIGHTS. */
  serviceBoost: Partial<Record<string, number>>;
  /** Share of arrivals with a priority flag. */
  priorityRate: number;
  /** Share of walk-ins issued by the greeter (customers who can't use kiosk/app). */
  greeterShare: number;
  /** Branch-level handle-time multiplier — what the engine "learns" (e.g. seniors take longer). */
  handleSpeed: number;
  /** College area: extra start-of-month boost on QUICK (fee payments, stipends). */
  quickStartOfMonthBoost?: number;
  story: string;
}

export const DEFAULT_DOW = [0, 1.2, 1.0, 0.95, 0.95, 1.05, 1.1];

export const DEFAULT_SERVICE_WEIGHTS: Record<Category, Record<string, number>> = {
  QUICK: {
    cash_deposit: 30,
    cash_withdrawal: 20,
    cheque_deposit: 14,
    passbook_update: 16,
    cheque_book_request: 8,
    neft_rtgs: 12,
  },
  STANDARD: {
    demand_draft: 12,
    kyc_update: 18,
    address_mobile_update: 14,
    debit_card: 18,
    fd_open_close: 15,
    nominee_update: 7,
    life_certificate: 10,
  },
  COMPLEX: {
    account_opening: 30,
    loan_enquiry: 25,
    loan_application: 13,
    locker_services: 12,
    complaint_dispute: 20,
  },
};

export const PROFILES: Record<string, BranchProfile> = {
  BR01: {
    dailyVolume: 175,
    hourCurve: [0.8, 1.0, 1.25, 1.9, 1.6, 1.0, 0.65],
    categoryMix: { QUICK: 0.6, STANDARD: 0.25, COMPLEX: 0.15 },
    dowFactor: DEFAULT_DOW,
    serviceBoost: { neft_rtgs: 1.6, cheque_deposit: 1.4, demand_draft: 1.3, life_certificate: 0.3 },
    priorityRate: 0.04,
    greeterShare: 0.08,
    handleSpeed: 0.95,
    story: "Office crowd: sharp lunch-hour (13:00–14:00) peak, heavy on transfers and cheques.",
  },
  BR02: {
    dailyVolume: 140,
    hourCurve: [1.6, 1.35, 0.85, 0.7, 1.0, 1.45],
    categoryMix: { QUICK: 0.5, STANDARD: 0.33, COMPLEX: 0.17 },
    dowFactor: [0, 1.15, 1.0, 0.95, 0.95, 1.05, 1.3],
    serviceBoost: { address_mobile_update: 1.4, locker_services: 1.8, fd_open_close: 1.2 },
    priorityRate: 0.08,
    greeterShare: 0.12,
    handleSpeed: 1.0,
    story: "Residential: morning and late-afternoon peaks, busy working Saturdays, lockers.",
  },
  BR03: {
    dailyVolume: 105,
    hourCurve: [1.0, 1.4, 1.5, 1.2, 0.9, 0.7],
    categoryMix: { QUICK: 0.52, STANDARD: 0.28, COMPLEX: 0.2 },
    dowFactor: [0, 1.15, 1.0, 1.5, 0.95, 1.0, 1.05], // Wednesday = weekly market day
    serviceBoost: { loan_enquiry: 1.8, loan_application: 1.8, cash_deposit: 1.3, passbook_update: 1.4, neft_rtgs: 0.6 },
    priorityRate: 0.07,
    greeterShare: 0.22,
    handleSpeed: 1.05,
    story: "Semi-urban: Wednesday market-day rush, farmers' cash deposits and loan (KCC/gold) traffic.",
  },
  BR04: {
    dailyVolume: 108,
    hourCurve: [1.7, 1.6, 1.15, 0.8, 0.7, 0.6],
    categoryMix: { QUICK: 0.4, STANDARD: 0.45, COMPLEX: 0.15 },
    dowFactor: DEFAULT_DOW,
    serviceBoost: {
      life_certificate: 3,
      passbook_update: 1.6,
      fd_open_close: 1.6,
      nominee_update: 1.5,
      loan_enquiry: 0.4,
      loan_application: 0.3,
      neft_rtgs: 0.6,
    },
    priorityRate: 0.3,
    greeterShare: 0.25,
    handleSpeed: 1.15,
    story: "Senior-heavy: early-morning peak, pension days (1st–7th) flood the Standard queue.",
  },
  BR05: {
    dailyVolume: 132,
    hourCurve: [0.6, 0.9, 1.2, 1.4, 1.3, 1.1],
    categoryMix: { QUICK: 0.72, STANDARD: 0.18, COMPLEX: 0.1 },
    dowFactor: DEFAULT_DOW,
    serviceBoost: {
      neft_rtgs: 1.8,
      cash_withdrawal: 1.5,
      debit_card: 1.8,
      account_opening: 1.5,
      demand_draft: 1.6,
      loan_enquiry: 1.3,
      locker_services: 0.2,
      life_certificate: 0.1,
      fd_open_close: 0.5,
    },
    priorityRate: 0.02,
    greeterShare: 0.03,
    handleSpeed: 0.9,
    quickStartOfMonthBoost: 1.2,
    story: "College area: Quick-heavy afternoons, start-of-month fee/DD rush, many new accounts.",
  },
};

/** Share of arrivals that booked an appointment in the app, per category. */
export const APPOINTMENT_SHARE: Record<Category, number> = { QUICK: 0.03, STANDARD: 0.12, COMPLEX: 0.25 };

/** Walk-in channel mix (before greeter share is applied). */
export const WALKIN_SOURCES: Partial<Record<TokenSource, number>> = { KIOSK: 0.75, APP_WALKIN: 0.25 };

export const PRIORITY_MIX: Partial<Record<Exclude<PriorityFlag, "NONE">, number>> = {
  SENIOR: 0.8,
  DISABLED: 0.1,
  PREGNANT: 0.1,
};

export function serviceWeights(profile: BranchProfile, category: Category): Record<string, number> {
  const base = DEFAULT_SERVICE_WEIGHTS[category];
  return Object.fromEntries(Object.entries(base).map(([id, w]) => [id, w * (profile.serviceBoost[id] ?? 1)]));
}
