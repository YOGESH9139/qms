import { config } from "dotenv";
import path from "node:path";

// Load .env.local first (Next.js convention), then .env as a fallback. Neither overrides real env vars.
export function loadEnv(): void {
  const root = path.resolve(__dirname, "..", "..");
  config({ path: path.join(root, ".env.local") });
  config({ path: path.join(root, ".env") });
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.includes("YOUR-")) {
    console.error(`\n✖ ${name} is not set. Copy .env.local.example to .env.local and fill it in.\n`);
    process.exit(1);
  }
  return v;
}
