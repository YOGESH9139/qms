/**
 * Applies supabase/migrations/*.sql in filename order, once each (tracked in schema_migrations).
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --force re-run every file (they are written to be idempotent)
 */
import fs from "node:fs";
import path from "node:path";

import { connect } from "./lib/db";
import { loadEnv, requireEnv } from "./lib/env";

async function main() {
  loadEnv();
  const force = process.argv.includes("--force");
  const dir = path.resolve(__dirname, "..", "supabase", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const client = await connect(requireEnv("DATABASE_URL"));
  try {
    await client.query(
      `create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`
    );
    const applied = new Set(
      (await client.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name)
    );

    for (const file of files) {
      if (applied.has(file) && !force) {
        console.log(`  · ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into schema_migrations (name) values ($1) on conflict (name) do update set applied_at = now()",
          [file]
        );
        await client.query("commit");
        console.log(`  ✔ ${file}`);
      } catch (e) {
        await client.query("rollback");
        console.error(`  ✖ ${file}`);
        throw e;
      }
    }
    // Ask PostgREST (Supabase API) to pick up new tables immediately.
    await client.query("notify pgrst, 'reload schema'");
    console.log("Migrations complete.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
