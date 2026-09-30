// Rule-based intake (fallback when the LLM is unavailable). Pure — also usable client-side.

import { SERVICES, SERVICE_BY_ID } from "@/lib/data/catalog";
import type { Category } from "@/lib/types";

export interface IntakeTurn {
  role: "user" | "assistant";
  text: string;
}

export interface IntakeResult {
  done: boolean;
  question: string | null;
  options: string[];
  service_id: string | null;
  confidence: number;
  summary: string;
  extra_notes: string;
  source?: "llm" | "rules";
}

export const CATEGORY_CHIPS: Record<Category, string> = {
  QUICK: "Cash, cheque, passbook or transfer",
  STANDARD: "Card, KYC, FD, address or pension",
  COMPLEX: "New account, loan, locker or complaint",
};

const CATEGORY_CHIPS_HI: Record<Category, string> = {
  QUICK: "नकद, चेक, पासबुक या ट्रांसफर",
  STANDARD: "कार्ड, केवाईसी, एफडी, पता या पेंशन",
  COMPLEX: "नया खाता, लोन, लॉकर या शिकायत",
};

export function keywordScores(text: string): { id: string; score: number }[] {
  const t = ` ${text.toLowerCase()} `;
  return SERVICES.map((s) => {
    let score = 0;
    if (t.includes(s.name.toLowerCase())) score += 3;
    for (const k of s.keywords) if (t.includes(k.toLowerCase())) score += k.includes(" ") ? 2 : 1;
    return { id: s.id, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function rulesIntake(history: IntakeTurn[], lang: "en" | "hi" = "en"): IntakeResult {
  const userTurns = history.filter((h) => h.role === "user");
  const last = userTurns[userTurns.length - 1]?.text ?? "";
  const all = userTurns.map((u) => u.text).join(" ");
  const summaryBase = userTurns[0]?.text ?? last;

  // exact service-name answer (from a chip)
  const exact = SERVICES.find((s) => s.name.toLowerCase() === last.trim().toLowerCase() || s.name_hi === last.trim());
  if (exact) return done(exact.id, 0.95, summaryBase);

  // category chip answer -> offer that category's services
  const catEntry = (Object.keys(CATEGORY_CHIPS) as Category[]).find(
    (c) => CATEGORY_CHIPS[c] === last || CATEGORY_CHIPS_HI[c] === last
  );
  if (catEntry) {
    const opts = SERVICES.filter((s) => s.category === catEntry).map((s) => (lang === "hi" ? s.name_hi : s.name));
    return ask(lang === "hi" ? "इनमें से कौन सा?" : "Which one of these?", opts.slice(0, 7));
  }

  const scores = keywordScores(all);
  const top = scores[0];
  const second = scores[1];
  // A single weak keyword (< 70% sure) gets a follow-up question instead of a guess (section 5.1).
  if (top && top.score >= 2 && (!second || top.score > second.score)) {
    return done(top.id, top.score >= 3 ? 0.85 : 0.72, summaryBase);
  }
  if (userTurns.length >= 3) {
    return done(top?.id ?? "complaint_dispute", 0.5, summaryBase);
  }
  const chips = lang === "hi" ? CATEGORY_CHIPS_HI : CATEGORY_CHIPS;
  return ask(lang === "hi" ? "आपका काम किससे जुड़ा है?" : "Which of these is closest to what you need?", Object.values(chips));

  function done(id: string, confidence: number, summary: string): IntakeResult {
    return {
      done: true,
      question: null,
      options: [],
      service_id: id,
      confidence,
      summary:
        summary.trim().toLowerCase() === SERVICE_BY_ID[id].name.toLowerCase() || summary.trim() === SERVICE_BY_ID[id].name_hi
          ? `Customer came for ${SERVICE_BY_ID[id].name.toLowerCase()}`
          : `${SERVICE_BY_ID[id].name}: ${summary}`.slice(0, 160),
      extra_notes: "",
      source: "rules",
    };
  }
  function ask(question: string, options: string[]): IntakeResult {
    return { done: false, question, options, service_id: null, confidence: 0.3, summary: summaryBase, extra_notes: "", source: "rules" };
  }
}
