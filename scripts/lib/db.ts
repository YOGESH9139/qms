import { Client } from "pg";

export async function connect(databaseUrl: string): Promise<Client> {
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(databaseUrl);
  const client = new Client({
    connectionString: databaseUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

// Postgres caps a statement at 65535 bind parameters.
const MAX_PARAMS = 60000;

/** Multi-row INSERT in batches. Values must already be pg-ready (JSON columns pre-stringified). */
export async function bulkInsert(
  client: Client,
  table: string,
  columns: string[],
  rows: unknown[][],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  if (rows.length === 0) return;
  const batchSize = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  const colList = columns.map((c) => `"${c}"`).join(", ");
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const params: unknown[] = [];
    const tuples = batch.map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(", ")})`;
    });
    await client.query(`insert into ${table} (${colList}) values ${tuples.join(", ")}`, params);
    onProgress?.(Math.min(i + batchSize, rows.length), rows.length);
  }
}
