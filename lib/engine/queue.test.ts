import { describe, expect, it } from "vitest";

import { SERVICE_BY_ID } from "@/lib/data/catalog";
import type { Counter, Token } from "@/lib/types";

import { callNext, checkIn, complete, projectEtas, skip, startServing, transfer, type QueueContext } from "./queue";

const T0 = new Date("2026-09-30T10:00:00+05:30").getTime();
const at = (min: number) => new Date(T0 + min * 60000);
const ctxAt = (min: number): QueueContext => ({ now: at(min), services: SERVICE_BY_ID });

let n = 0;
function tok(service_id: string, arrivalMin: number, extra: Partial<Token> = {}): Token {
  n++;
  return {
    id: `t${n}`, branch_id: "BR01", code: `Q${String(n).padStart(3, "0")}`, service_id, customer_name: null,
    mobile_masked: null, source: "KIOSK", priority_flag: "NONE", status: "WAITING", created_at: at(arrivalMin).toISOString(),
    appointment_start: null, appointment_end: null, checked_in_at: null, called_at: null, serving_started_at: null,
    completed_at: null, counter_id: null, recall_count: 0, skip_count: 0, parked_until: null,
    original_arrival_at: at(arrivalMin).toISOString(), returning_boost: false, parent_token_id: null, ai_summary: null,
    outcome: null, could_be_digital: null, eta_minutes: null, position: null, ...extra,
  };
}

const counter = (extra: Partial<Counter> = {}): Counter => ({
  id: "BR01-C1", branch_id: "BR01", number: 1, staff_id: "S1", status: "AVAILABLE", mode_skill: "QUICK",
  status_since: at(0).toISOString(), break_expected_end: null, break_reason: null, ...extra,
});

describe("queue engine", () => {
  it("serves a priority customer ahead of a slightly earlier walk-in", () => {
    const early = tok("cash_deposit", 0);
    const senior = tok("cash_deposit", 3, { priority_flag: "SENIOR" });
    const r = callNext([early, senior], counter(), ["QUICK"], ctxAt(5))!;
    expect(r.token.id).toBe(senior.id);
    expect(r.token.status).toBe("CALLED");
    expect(r.reasons).toContain("priority: senior citizen");
    expect(r.events[0]).toMatchObject({ type: "CALL", from_status: "WAITING", to_status: "CALLED" });
  });

  it("rescues an SLA breach over a fresh priority token", () => {
    const breached = tok("cash_deposit", 0); // 12 min > 10 target
    const senior = tok("cash_deposit", 11, { priority_flag: "SENIOR" });
    const r = callNext([senior, breached], counter(), ["QUICK"], ctxAt(12))!;
    expect(r.token.id).toBe(breached.id);
    expect(r.reasons.some((x) => x.startsWith("SLA breached"))).toBe(true);
  });

  it("holds appointments until 10 min before, boosts them in-window, converts late arrivals", () => {
    const appt = tok("kyc_update", 0, {
      source: "APP_APPOINTMENT",
      appointment_start: at(30).toISOString(),
      appointment_end: at(60).toISOString(),
      original_arrival_at: at(30).toISOString(),
    });
    const walkin = tok("kyc_update", 28); // earlier than the appointment's window start, within SLA
    const c = counter({ mode_skill: "STANDARD" });
    expect(callNext([appt], c, ["STANDARD"], ctxAt(19))).toBeNull(); // 11 min early
    expect(callNext([appt, walkin], c, ["STANDARD"], ctxAt(35))!.token.id).toBe(appt.id); // +30 in window

    const booked = { ...appt, status: "BOOKED" as const };
    expect(checkIn(booked, ctxAt(70)).token.appointment_start).not.toBeNull(); // 10 min late: still an appointment
    const late = checkIn(booked, ctxAt(80)); // 20 min after window end
    expect(late.token).toMatchObject({ status: "WAITING", appointment_start: null });
    expect(late.events[0].type).toBe("LATE_CONVERTED");
  });

  it("only offers tokens the counter's staff is skilled for", () => {
    const loan = tok("loan_application", 0);
    expect(callNext([loan], counter(), ["QUICK", "STANDARD"], ctxAt(30))).toBeNull();
    expect(callNext([loan], counter(), ["LOANS"], ctxAt(30))!.token.id).toBe(loan.id);
  });

  it("transfer keeps original arrival time and adds the returning boost", () => {
    const c = counter({ mode_skill: "STANDARD" });
    const called = callNext([tok("complaint_dispute", 0)], c, ["COMPLEX"], ctxAt(5))!;
    const serving = startServing(called.token, called.counter, ctxAt(6));
    const r = transfer(serving.token, called.counter, "debit_card", "Needs card reissue", ctxAt(20));
    expect(r.token).toMatchObject({
      status: "WAITING", service_id: "debit_card", returning_boost: true, counter_id: null,
      original_arrival_at: at(0).toISOString(),
    });
    expect(r.counter!.status).toBe("AVAILABLE");
    expect(r.events[0]).toMatchObject({ type: "TRANSFER", from_status: "SERVING", to_status: "WAITING" });
    expect(() => complete(r.token, c, "RESOLVED", false, ctxAt(21))).toThrow(); // WAITING can't complete
  });

  it("moves back 3 places on the 1st miss and marks NO_SHOW on the 2nd", () => {
    const others = [1, 2, 3, 4].map((m) => tok("cash_deposit", m));
    const first = tok("cash_deposit", 0);
    let all = [first, ...others];
    const c1 = callNext(all, counter(), ["QUICK"], ctxAt(5))!;
    expect(c1.token.id).toBe(first.id);

    const miss1 = skip(c1.token, c1.counter, all, ctxAt(7));
    expect(miss1.token).toMatchObject({ status: "WAITING", skip_count: 1 });
    all = [miss1.token, ...others];
    const order: string[] = [];
    let q = all;
    for (let i = 0; i < 4; i++) {
      const r = callNext(q, counter(), ["QUICK"], ctxAt(8))!;
      order.push(r.token.id);
      q = q.filter((t) => t.id !== r.token.id);
    }
    expect(order.indexOf(first.id)).toBe(3); // behind 3 others

    const c2 = callNext([miss1.token], counter(), ["QUICK"], ctxAt(20))!;
    const miss2 = skip(c2.token, c2.counter, [], ctxAt(22));
    expect(miss2.token.status).toBe("NO_SHOW");
    expect(miss2.events[0].to_status).toBe("NO_SHOW");
  });

  it("projects sane ETAs across counters", () => {
    const tokens = [0, 1, 2, 3].map((m) => tok("cash_deposit", m)); // 4 min each
    const c1 = counter();
    const c2 = counter({ id: "BR01-C2", number: 2, staff_id: "S2", status: "ON_BREAK", break_expected_end: at(20).toISOString() });
    const etas = projectEtas(tokens, [c1, c2], { S1: ["QUICK"], S2: ["QUICK"] }, {
      ...ctxAt(10),
      avgHandle: { cash_deposit: 4 },
    });
    expect(tokens.map((t) => etas.get(t.id)!.eta_minutes)).toEqual([0, 4, 8, 10]); // C2 back at +10
    expect(tokens.map((t) => etas.get(t.id)!.position)).toEqual([1, 2, 3, 4]);

    const loan = tok("loan_application", 0);
    expect(projectEtas([loan], [c1], { S1: ["QUICK"] }, ctxAt(10)).get(loan.id)).toEqual({ eta_minutes: null, position: null });
  });
});
