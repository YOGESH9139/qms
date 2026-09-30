import "server-only";

// LLM usage is limited to conversation, classification and phrasing. Every caller has a rule-based fallback,
// so a missing key, timeout, refusal or bad JSON never breaks the demo.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const TIMEOUT_MS = 12_000;

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 });
  return client;
}

export function llmEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function textOf(content: { type: string }[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** One request constrained to a JSON schema. Returns null on any failure (caller falls back to rules). */
export async function llmJson<T>(system: string, user: string, schema: Record<string, unknown>, maxTokens = 1024): Promise<T | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const params = {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user" as const, content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    const res = await c.beta.messages.create(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
    return JSON.parse(textOf(res.content)) as T;
  } catch (e) {
    console.warn("[llm] falling back to rules:", (e as Error).message);
    return null;
  }
}

/** Free-text phrasing. Returns null on failure. */
export async function llmText(system: string, user: string, maxTokens = 400): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const params = {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user" as const, content: user }],
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    const res = await c.beta.messages.create(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal") return null;
    const t = textOf(res.content).trim();
    return t || null;
  } catch (e) {
    console.warn("[llm] text fallback:", (e as Error).message);
    return null;
  }
}
