/** Kenyan phone normalisation → +254XXXXXXXXX. Returns null if invalid. */
export function normalizeKEPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const d = digits;
  if (d.startsWith("254") && d.length === 12) return "+" + d;
  if ((d.startsWith("07") || d.startsWith("01")) && d.length === 10) return "+254" + d.slice(1);
  if (d.length === 9 && (d.startsWith("7") || d.startsWith("1"))) return "+254" + d;
  return null;
}

/** STK format: 2547XXXXXXXX (no plus). */
export function toSTKFormat(input: string): string | null {
  const n = normalizeKEPhone(input);
  if (!n) return null;
  return n.replace("+", "");
}

export function formatKES(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(n)) return "KSh 0.00";
  return "KSh " + n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const NAIROBI_TZ = "Africa/Nairobi";
export const DEFAULT_CURRENCY = "KES";
