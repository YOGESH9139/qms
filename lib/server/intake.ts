import "server-only";

import { SERVICES, SERVICE_BY_ID } from "@/lib/data/catalog";
import { rulesIntake, type IntakeResult, type IntakeTurn } from "@/lib/intake-rules";
import type { FeedbackTopic, Sentiment } from "@/lib/types";

import { llmJson, llmText } from "./llm";

const MAX_TURNS = 5;

const INTAKE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["done", "question", "options", "service_id", "confidence", "summary", "extra_notes"],
  properties: {
    done: { type: "boolean" },
    question: { type: ["string", "null"] },
    options: { type: "array", items: { type: "string" } },
    service_id: { type: ["string", "null"] },
    confidence: { type: "number" },
    summary: { type: "string" },
    extra_notes: { type: "string" },
  },
};

const CATALOG = SERVICES.map(
  (s) => `- ${s.id}: ${s.name} [${s.category}] — keywords: ${s.keywords.slice(0, 8).join(", ")}`
).join("\n");

const SYSTEM = `You are the intake assistant for "Sample Demo Bank" (a demo, not a real bank). Identify which ONE branch service the customer needs.

Services (use the id exactly):
${CATALOG}

Rules:
- If you are at least 70% sure, set done=true, service_id, confidence, question=null, options=[].
- Otherwise set done=false and ask ONE short follow-up question with 2-4 short tappable options (the UI adds "Other" itself).
- Never ask for, and never repeat, account numbers, Aadhaar, PAN, card numbers, PINs or OTPs.
- summary: one line for the counter staff describing the customer's problem (no personal identifiers).
- extra_notes: anything useful for staff (urgency, lost card, senior citizen, etc.) or "".
- Reply in the customer's language (English or Hindi) for question/options; summary always in English.`;

export async function classifyIntake(history: IntakeTurn[], lang: "en" | "hi"): Promise<IntakeResult> {
  const userTurns = history.filter((h) => h.role === "user").length;
  const forceFinish = userTurns >= MAX_TURNS - 1;
  const transcript = history.map((h) => `${h.role === "user" ? "Customer" : "Assistant"}: ${h.text}`).join("\n");
  const r = await llmJson<IntakeResult>(
    SYSTEM,
    `Language: ${lang === "hi" ? "Hindi" : "English"}\n${forceFinish ? "This is the last turn: you MUST set done=true with your best guess.\n" : ""}\nConversation:\n${transcript}`,
    INTAKE_SCHEMA
  );
  if (r && (r.done ? r.service_id && SERVICE_BY_ID[r.service_id] : r.question && r.options?.length)) {
    if (r.done && r.confidence < 0.7 && !forceFinish && r.options?.length) r.done = false;
    return { ...r, options: (r.options ?? []).slice(0, 4), source: "llm" };
  }
  return rulesIntake(history, lang);
}

// ---------------------------------------------------------------- feedback tagging (9.5)

const TOPICS: FeedbackTopic[] = [
  "wait_time", "staff_behaviour", "documents_confusion", "system_down", "process_complexity", "cleanliness", "other",
];

const TOPIC_KEYWORDS: Record<FeedbackTopic, string[]> = {
  wait_time: ["wait", "long", "slow", "time", "queue", "late", "jaldi", "quick", "fast", "der"],
  staff_behaviour: ["staff", "rude", "polite", "helpful", "behaviour", "behavior", "madam", "sir", "explained"],
  documents_confusion: ["document", "photocopy", "form", "proof", "copy", "checklist", "come back"],
  system_down: ["server", "system", "down", "not working", "network"],
  process_complexity: ["complicated", "complex", "steps", "process", "twice", "confusing"],
  cleanliness: ["clean", "dirty", "crowded", "seating", "smell"],
  other: [],
};

export function rulesTag(rating: number, comment: string | null): { sentiment: Sentiment; topics: FeedbackTopic[] } {
  const sentiment: Sentiment = rating >= 4 ? "pos" : rating === 3 ? "neu" : "neg";
  const t = (comment ?? "").toLowerCase();
  const topics = TOPICS.filter((k) => TOPIC_KEYWORDS[k].some((w) => t.includes(w)));
  return { sentiment, topics: topics.length ? topics : comment ? ["other"] : [] };
}

export async function tagFeedback(rating: number, comment: string | null) {
  if (!comment?.trim()) return rulesTag(rating, comment);
  const r = await llmJson<{ sentiment: Sentiment; topics: FeedbackTopic[] }>(
    "Tag bank-branch customer feedback. sentiment: pos, neu or neg. topics: any that apply from the allowed list.",
    `Rating: ${rating}/5\nComment: ${comment}`,
    {
      type: "object",
      additionalProperties: false,
      required: ["sentiment", "topics"],
      properties: {
        sentiment: { type: "string", enum: ["pos", "neu", "neg"] },
        topics: { type: "array", items: { type: "string", enum: TOPICS } },
      },
    },
    256
  );
  return r ?? rulesTag(rating, comment);
}

/** LLM may only rephrase an explanation. Numbers must survive; otherwise keep the original. */
export async function friendlier(text: string): Promise<string> {
  const out = await llmText(
    "Rewrite this bank-branch operations recommendation for a branch manager in friendly, plain English. Keep every number, name and counter exactly as given. Max 2 sentences. Output only the rewritten text.",
    text,
    300
  );
  if (!out) return text;
  const nums = text.match(/\d+(\.\d+)?/g) ?? [];
  return nums.every((n) => out.includes(n)) ? out : text;
}
