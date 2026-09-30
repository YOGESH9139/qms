import "server-only";

import { NextResponse } from "next/server";

import { QueueError } from "@/lib/engine/queue";

/** Wrap a route handler: JSON result, QueueError -> 400 with a friendly message, anything else -> 500. */
export async function handle(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return NextResponse.json(data ?? {});
  } catch (e) {
    const status = e instanceof QueueError ? 400 : 500;
    if (status === 500) console.error(e);
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
