/** Sale/order money math. All amounts in major units (KSh), rounded to 2dp. */
export type SaleLine = { qty: number; unitPrice: number; discount?: number };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineTotal(line: SaleLine): number {
  if (line.qty < 0) throw new Error("Quantity cannot be negative");
  if (line.unitPrice < 0) throw new Error("Unit price cannot be negative");
  const discount = line.discount ?? 0;
  if (discount < 0) throw new Error("Discount cannot be negative");
  const gross = line.qty * line.unitPrice;
  if (discount > gross) throw new Error("Discount exceeds line gross");
  return r2(gross - discount);
}

export function orderTotals(
  lines: SaleLine[],
  opts: { orderDiscount?: number; taxRate?: number } = {},
): { subtotal: number; discountTotal: number; taxTotal: number; totalDue: number } {
  const subtotal = r2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const lineDiscounts = r2(lines.reduce((s, l) => s + (l.discount ?? 0), 0));
  const orderDiscount = opts.orderDiscount ?? 0;
  if (orderDiscount < 0) throw new Error("Order discount cannot be negative");
  const discountTotal = r2(lineDiscounts + orderDiscount);
  if (discountTotal > subtotal) throw new Error("Discount exceeds subtotal");
  const taxable = r2(subtotal - discountTotal);
  const taxTotal = r2(taxable * (opts.taxRate ?? 0));
  return { subtotal, discountTotal, taxTotal, totalDue: r2(taxable + taxTotal) };
}

/** Subscription tier lookup: first tier whose maxQualifying >= sales. */
export type Tier = { upTo: number; fee: number };
export const DEFAULT_TIERS: Tier[] = [
  { upTo: 50_000, fee: 4_000 },
  { upTo: 200_000, fee: 6_000 },
  { upTo: 500_000, fee: 9_000 },
  { upTo: 1_000_000, fee: 12_000 },
];

export function tierFeeForSales(sales: number, tiers: Tier[] = DEFAULT_TIERS): number {
  for (const t of tiers) if (sales <= t.upTo) return t.fee;
  return -1; // custom tier — must be configured, never silently charged
}
