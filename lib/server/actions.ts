import "server-only";

import { createHash } from "node:crypto";

import { fromIst, istParts } from "@/lib/clock";
import { COUNTERS } from "@/lib/data/branches";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import { nextWorkingDay } from "@/lib/engine/calendar";
import {
  addService,
  callNext,
  cancel,
  checkIn,
  complete,
  issueToken,
  park,
  QueueError,
  recall,
  skip,
  startServing,
  transfer,
} from "@/lib/engine/queue";
import type { AiSummary, Counter, PriorityFlag, Skill, Token, TokenOutcome, TokenSource } from "@/lib/types";
import { maskMobile } from "@/lib/utils";

import { etaText, Workspace } from "./workspace";

export { QueueError };

export function hashMobile(mobile: string): string {
  return createHash("sha256").update(`branchflow:${mobile.replace(/\D/g, "").slice(-10)}`).digest("hex");
}

export function currentToken(ws: Workspace, counter: Counter): Token | undefined {
  return ws.tokens.find((t) => t.counter_id === counter.id && (t.status === "CALLED" || t.status === "SERVING"));
}

function requireCurrent(ws: Workspace, counter: Counter): Token {
  const t = currentToken(ws, counter);
  if (!t) throw new QueueError("No customer at this counter");
  return t;
}

// ---------------------------------------------------------------- issue / check-in

export interface IssueArgs {
  branchId: string;
  serviceId: string;
  source: TokenSource;
  name?: string | null;
  mobile?: string | null;
  priority?: PriorityFlag;
  aiSummary?: AiSummary | null;
  appointmentStart?: string | null;
  appointmentEnd?: string | null;
}

export function issue(ws: Workspace, a: IssueArgs): Token {
  if (!SERVICE_BY_ID[a.serviceId]) throw new QueueError("Unknown service");
  const digits = a.mobile?.replace(/\D/g, "") ?? "";
  const r = ws.apply(
    issueToken(
      {
        branch_id: a.branchId,
        service_id: a.serviceId,
        source: a.source,
        customer_name: a.name?.trim() || null,
        mobile_masked: digits.length >= 10 ? maskMobile(digits) : null,
        priority_flag: a.priority ?? "NONE",
        ai_summary: a.aiSummary ?? null,
        appointment_start: a.appointmentStart ?? null,
        appointment_end: a.appointmentEnd ?? null,
      },
      ws.todayCodes(),
      ws.ctx
    )
  );
  const token = { ...r.token, mobile_hash: digits.length >= 10 ? hashMobile(digits) : null } as Token;
  ws.putToken(token);
  return token;
}

export function smsIssued(ws: Workspace, t: Token) {
  const svc = SERVICE_BY_ID[t.service_id];
  if (t.status === "BOOKED") {
    ws.sms(t, `Sample Demo Bank: ${svc.name} booked for ${slotText(t)}. Booking code ${t.code}. Check in at the kiosk with your mobile number. Bring: ${svc.documents.filter((d) => d.required).map((d) => d.label.split("(")[0].trim()).slice(0, 3).join(", ")}.`);
  } else {
    const eta = ws.tokens.find((x) => x.id === t.id)?.eta_minutes ?? null;
    ws.sms(t, `Sample Demo Bank: your token ${t.code} for ${svc.name}. Estimated wait ${etaText(eta)}. Track live: /customer/token/${t.id}`);
  }
}

function slotText(t: Token): string {
  if (!t.appointment_start || !t.appointment_end) return "";
  const s = istParts(new Date(t.appointment_start));
  const e = istParts(new Date(t.appointment_end));
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
  return `${s.date} ${hm(s.minutes)}–${hm(e.minutes)}`;
}

/** Kiosk check-in by mobile number or booking code. */
export function checkInBooking(ws: Workspace, key: { mobile?: string; code?: string }): Token {
  const today = istParts(ws.now).date;
  const hash = key.mobile ? hashMobile(key.mobile) : null;
  const booked = ws.tokens.find(
    (t) =>
      t.status === "BOOKED" &&
      t.appointment_start &&
      istParts(new Date(t.appointment_start)).date === today &&
      ((hash && (t as Token & { mobile_hash?: string }).mobile_hash === hash) ||
        (key.code && t.code.toUpperCase() === key.code.trim().toUpperCase()))
  );
  if (!booked) throw new QueueError("No appointment found for today. You can take a walk-in token instead.");
  const r = ws.apply(checkIn(booked, ws.ctx));
  return r.token;
}

// ---------------------------------------------------------------- counter + token actions

export type CounterAction =
  | { action: "online" }
  | { action: "offline" }
  | { action: "break"; minutes: number; reason: string }
  | { action: "back" }
  | { action: "mode"; skill: Skill }
  | { action: "human"; on: boolean }
  | { action: "call" }
  | { action: "recall" }
  | { action: "start" }
  | { action: "skip" }
  | { action: "complete"; outcome: TokenOutcome; couldBeDigital: boolean }
  | { action: "transfer"; serviceId: string; note?: string }
  | { action: "park"; minutes: number; note?: string }
  | { action: "addService"; serviceId: string }
  | { action: "followUp"; date?: string; startMin?: number; serviceId?: string }
  | { action: "escalate"; note?: string }
  | { action: "note"; text: string };

export async function counterAction(ws: Workspace, counterId: string, a: CounterAction): Promise<Record<string, unknown>> {
  const c = ws.counter(counterId);
  const now = ws.now.toISOString();
  const staffName = ws.staff.find((s) => s.id === c.staff_id)?.name ?? "Staff";

  switch (a.action) {
    case "online":
      ws.putCounter({ ...c, status: "AVAILABLE", status_since: now, break_expected_end: null, break_reason: null }, "ONLINE");
      return {};
    case "offline":
      if (currentToken(ws, c)) throw new QueueError("Finish the current customer first");
      ws.putCounter({ ...c, status: "OFFLINE", status_since: now }, "OFFLINE");
      return {};
    case "break": {
      if (currentToken(ws, c)) throw new QueueError("Finish the current customer first");
      const end = new Date(ws.now.getTime() + a.minutes * 60000).toISOString();
      ws.putCounter({ ...c, status: "ON_BREAK", status_since: now, break_expected_end: end, break_reason: a.reason }, "BREAK_START", a.reason, { minutes: a.minutes });
      return {};
    }
    case "back":
      ws.putCounter({ ...c, status: "AVAILABLE", status_since: now, break_expected_end: null, break_reason: null }, "BREAK_END");
      return {};
    case "mode": {
      if (!ws.skillsOf(c).includes(a.skill)) throw new QueueError("Staff is not skilled for that focus");
      ws.putCounter({ ...c, mode_skill: a.skill }, "MODE_CHANGE", null, { from: c.mode_skill, to: a.skill });
      return {};
    }
    case "human":
      ws.putCounter({ ...c, human_control: a.on } as Counter);
      return {};
    case "call": {
      if (currentToken(ws, c)) throw new QueueError("Finish the current customer first");
      const r = ws.apply(callNext(ws.tokens, c, ws.skillsOf(c), ws.ctx));
      if (!r) return { empty: true };
      ws.sms(r.token, `Sample Demo Bank: token ${r.token.code}, please go to Counter ${c.number} now.`);
      return { token: r.token, reasons: r.reasons, score: r.score };
    }
    case "recall": {
      const t = requireCurrent(ws, c);
      ws.apply(recall(t, ws.ctx));
      ws.sms(t, `Reminder: token ${t.code}, Counter ${c.number} is calling you.`);
      return {};
    }
    case "start":
      ws.apply(startServing(requireCurrent(ws, c), c, ws.ctx));
      return {};
    case "skip": {
      const r = ws.apply(skip(requireCurrent(ws, c), c, ws.tokens, ws.ctx));
      if (r.token.status === "NO_SHOW") ws.sms(r.token, `Token ${r.token.code} was marked as not present. Please take a new token at the kiosk.`);
      else ws.sms(r.token, `Token ${r.token.code}: we missed you at Counter ${c.number}. You'll be called again shortly.`);
      return { status: r.token.status };
    }
    case "complete": {
      const r = ws.apply(complete(requireCurrent(ws, c), c, a.outcome, a.couldBeDigital, ws.ctx));
      ws.sms(r.token, `Thank you for visiting Sample Demo Bank. Rate your visit (1 min): /customer/token/${r.token.id}`);
      return {};
    }
    case "transfer": {
      const r = ws.apply(transfer(requireCurrent(ws, c), c, a.serviceId, a.note ?? null, ws.ctx));
      ws.sms(r.token, `Token ${r.token.code}: you've been moved to ${SERVICE_BY_ID[a.serviceId].name}. Your place in line is kept.`);
      return {};
    }
    case "park": {
      const r = ws.apply(park(requireCurrent(ws, c), c, a.minutes, a.note ?? null, ws.ctx));
      ws.sms(r.token, `Token ${r.token.code}: take your time (${a.minutes} min). You'll be called with priority when you're back.`);
      return {};
    }
    case "addService": {
      const t = requireCurrent(ws, c);
      const r = ws.apply(addService(t, a.serviceId, ws.todayCodes(), ws.ctx));
      return { created: r.created?.[0] };
    }
    case "followUp": {
      const t = requireCurrent(ws, c);
      const date = a.date ?? nextWorkingDay(istParts(ws.now).date);
      const start = a.startMin ?? 11 * 60;
      const booked = issue(ws, {
        branchId: ws.branchId,
        serviceId: a.serviceId ?? t.service_id,
        source: "APP_APPOINTMENT",
        name: t.customer_name,
        priority: t.priority_flag,
        aiSummary: t.ai_summary,
        appointmentStart: fromIst(date, start).toISOString(),
        appointmentEnd: fromIst(date, start + 30).toISOString(),
      });
      const withMobile = { ...booked, mobile_masked: t.mobile_masked, mobile_hash: (t as Token & { mobile_hash?: string }).mobile_hash ?? null, parent_token_id: t.id } as Token;
      ws.putToken(withMobile);
      smsIssued(ws, withMobile);
      ws.note(t.id, "FOLLOW_UP_BOOKED", `Follow-up ${withMobile.code}`, { token_id: withMobile.id });
      return { created: withMobile };
    }
    case "escalate": {
      const t = currentToken(ws, c);
      await ws.db.from("alerts").insert({
        branch_id: ws.branchId,
        type: "ESCALATION",
        severity: "CRITICAL",
        title: `Escalation from Counter ${c.number}`,
        why: `${staffName} needs the manager${t ? ` for token ${t.code} (${SERVICE_BY_ID[t.service_id].name})` : ""}. ${a.note ?? ""}`.trim(),
        status: "OPEN",
        dedupe_key: `esc:${c.id}:${now}`,
        at: now,
      });
      if (t) ws.note(t.id, "ESCALATE", a.note ?? null);
      return {};
    }
    case "note": {
      const t = requireCurrent(ws, c);
      ws.events.push({
        token_id: t.id, type: "NOTE", from_status: null, to_status: null, counter_id: c.id, staff_id: c.staff_id,
        note: a.text, meta: null, at: now,
      });
      return {};
    }
  }
}

// ---------------------------------------------------------------- customer self-service

export function customerLate(ws: Workspace, tokenId: string, minutes = 10): Token {
  const t = ws.token(tokenId);
  if (t.status === "WAITING") {
    const until = new Date(ws.now.getTime() + minutes * 60000).toISOString();
    const next = { ...t, parked_until: until };
    ws.putToken(next);
    ws.note(t.id, "RUNNING_LATE", `Customer running ${minutes} min late — held without losing place`);
    return next;
  }
  if (t.status === "BOOKED") {
    ws.note(t.id, "RUNNING_LATE", `Customer running ${minutes} min late for appointment`);
    return t;
  }
  throw new QueueError(`Can't mark a ${t.status.toLowerCase()} token as late`);
}

export function customerCancel(ws: Workspace, tokenId: string): Token {
  const r = ws.apply(cancel(ws.token(tokenId), ws.ctx, "Cancelled by customer"));
  return r.token;
}

export function counterForStaff(staffId: string) {
  return COUNTERS.find((c) => c.staff_id === staffId);
}
