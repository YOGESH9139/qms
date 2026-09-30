// Templated feedback comments (English + some Hinglish) with ground-truth topics.
import type { FeedbackTopic, Sentiment } from "@/lib/types";
import { chance, pick, type Rng } from "@/lib/random";

interface Template {
  text: string;
  topics: FeedbackTopic[];
}

const POSITIVE: Template[] = [
  { text: "Quick service, done in no time. Thank you!", topics: ["wait_time"] },
  { text: "Staff at the counter was very helpful and polite.", topics: ["staff_behaviour"] },
  { text: "Bahut accha service, jaldi ho gaya.", topics: ["wait_time"] },
  { text: "Got my {service} done without any confusion. The document checklist helped.", topics: ["documents_confusion"] },
  { text: "Madam explained everything patiently. Very good.", topics: ["staff_behaviour"] },
  { text: "Token system is clear, I knew exactly when my turn would come.", topics: ["wait_time"] },
  { text: "Branch was clean and well organised.", topics: ["cleanliness"] },
  { text: "Staff ne achhe se samjhaya, thank you.", topics: ["staff_behaviour"] },
];

const NEUTRAL: Template[] = [
  { text: "Took a bit long but the work got done.", topics: ["wait_time"] },
  { text: "Thoda wait karna pada, baaki theek tha.", topics: ["wait_time"] },
  { text: "OK experience. Forms for {service} could be simpler.", topics: ["process_complexity"] },
  { text: "Had to fill the same details twice.", topics: ["process_complexity"] },
  { text: "Seating area was crowded.", topics: ["cleanliness", "wait_time"] },
];

const NEGATIVE_WAIT: Template[] = [
  { text: "Waited {wait} minutes for a simple {service}. Too slow.", topics: ["wait_time"] },
  { text: "Only one counter open for {service} while others were free.", topics: ["wait_time", "staff_behaviour"] },
  { text: "{wait} min wait, bahut time waste hua.", topics: ["wait_time"] },
  { text: "Counters closed during lunch and the queue kept growing.", topics: ["wait_time", "staff_behaviour"] },
];

const NEGATIVE_DOCS: Template[] = [
  { text: "Nobody told me which documents to bring for {service}. Had to come back.", topics: ["documents_confusion"] },
  { text: "Sent from one counter to another. Documents list was not clear.", topics: ["documents_confusion", "process_complexity"] },
  { text: "Photocopy nahi laaya tha, kisi ne pehle bataya nahi.", topics: ["documents_confusion"] },
];

const NEGATIVE_OTHER: Template[] = [
  { text: "Server down tha, 20 min wasted at the counter.", topics: ["system_down"] },
  { text: "System was not working, asked to come tomorrow.", topics: ["system_down"] },
  { text: "Staff was rude and did not listen.", topics: ["staff_behaviour"] },
  { text: "Too many steps for {service}. Very complicated process.", topics: ["process_complexity"] },
];

export interface FeedbackContext {
  waitMin: number;
  targetWaitMin: number;
  transferred: boolean;
  partial: boolean;
  serviceName: string;
}

export function sentimentFor(rating: number): Sentiment {
  return rating >= 4 ? "pos" : rating === 3 ? "neu" : "neg";
}

export function makeComment(
  rng: Rng,
  rating: number,
  ctx: FeedbackContext
): { comment: string | null; topics: FeedbackTopic[] } {
  if (!chance(rng, 0.6)) return { comment: null, topics: [] };
  let t: Template;
  if (rating >= 4) t = pick(rng, POSITIVE);
  else if (rating === 3) t = pick(rng, NEUTRAL);
  else if (ctx.transferred || ctx.partial) t = pick(rng, NEGATIVE_DOCS);
  else if (ctx.waitMin > ctx.targetWaitMin * 1.3) t = pick(rng, NEGATIVE_WAIT);
  else t = pick(rng, NEGATIVE_OTHER);
  const comment = t.text
    .replace("{service}", ctx.serviceName.toLowerCase())
    .replace("{wait}", String(Math.max(1, Math.round(ctx.waitMin))));
  return { comment, topics: t.topics };
}
