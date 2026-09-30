// Mask sensitive identifiers typed by customers (section 5.1). Runs on client and server.

const PATTERNS: [RegExp, string][] = [
  [/\b[A-Z]{5}\d{4}[A-Z]\b/gi, "PAN"],
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "card number"],
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "Aadhaar number"],
  [/\b\d{9,18}\b/g, "account number"],
];

export function maskSensitive(text: string): { text: string; found: string[] } {
  const found = new Set<string>();
  let out = text;
  for (const [re, label] of PATTERNS) {
    out = out.replace(re, (m) => {
      found.add(label);
      const digits = m.replace(/[\s-]/g, "");
      return `${"x".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
    });
  }
  return { text: out, found: [...found] };
}
