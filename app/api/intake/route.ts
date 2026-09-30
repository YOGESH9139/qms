import type { IntakeTurn } from "@/lib/intake-rules";
import { maskSensitive } from "@/lib/sensitive";
import { body, handle } from "@/lib/server/api";
import { classifyIntake } from "@/lib/server/intake";

export const dynamic = "force-dynamic";

/** Conversational intake: returns the strict JSON from section 5.1 (LLM, falling back to keyword rules). */
export async function POST(req: Request) {
  return handle(async () => {
    const { history = [], lang = "en" } = await body<{ history: IntakeTurn[]; lang: "en" | "hi" }>(req);
    let warned: string[] = [];
    const safe = history.slice(-10).map((h) => {
      const m = maskSensitive(h.text);
      if (h.role === "user") warned = [...warned, ...m.found];
      return { ...h, text: m.text };
    });
    const result = await classifyIntake(safe, lang);
    return { ...result, masked: [...new Set(warned)] };
  });
}
