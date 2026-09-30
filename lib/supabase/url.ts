/** Accepts the project URL with or without a pasted "/rest/v1/" suffix. */
export function supabaseUrl(raw: string | undefined): string | undefined {
  return raw?.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}
