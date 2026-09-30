import fs from "node:fs";
import path from "node:path";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) s = v.join(";");
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Write rows as CSV. String arrays become `a;b;c`, objects become JSON. */
export function writeCsv(dir: string, name: string, columns: string[], rows: unknown[][]): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.csv`);
  const lines = [columns.join(","), ...rows.map((r) => r.map(cell).join(","))];
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return file;
}
