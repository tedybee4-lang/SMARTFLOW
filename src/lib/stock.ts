/**
 * Stock-on-hand helpers for the POS checkout path.
 *
 * The append-only `stock_movements` ledger is the single source of truth:
 * current stock = SUM(quantity_delta) per product. We try the
 * `stock_on_hand` RPC (migration 20261018000006) first and fall back to a
 * capped JS sum so checkout keeps working if the RPC is not yet applied.
 */

type MovementRow = { product_id: string; quantity_delta: number };

/** Pure sum of ledger rows → Map<productId, onHand>. Unit-testable. */
export function onHandFromMovements(rows: MovementRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.product_id, (m.get(r.product_id) ?? 0) + Number(r.quantity_delta));
  }
  return m;
}

/** Cap on ledger rows scanned per checkout request (safety valve). */
const LEDGER_SCAN_CAP = 5000;

export type SupabaseLike = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        in: (col: string, vals: unknown[]) => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

/**
 * Current on-hand stock for the given products of a business.
 * Returns a Map<product_id, onHand>; missing entries mean zero stock.
 */
export async function fetchOnHand(
  db: SupabaseLike,
  businessId: string,
  productIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  try {
    const { data, error } = await db.rpc("stock_on_hand", { p_business_id: businessId, p_product_ids: productIds });
    if (!error && Array.isArray(data)) {
      return new Map((data as { product_id: string; on_hand: number }[]).map((r) => [r.product_id, Number(r.on_hand)]));
    }
  } catch {
    // RPC not applied yet — fall through to the ledger scan.
  }
  const { data } = await db
    .from("stock_movements")
    .select("product_id,quantity_delta")
    .eq("business_id", businessId)
    .in("product_id", productIds);
  const rows = ((data ?? []) as MovementRow[]).slice(0, LEDGER_SCAN_CAP);
  return onHandFromMovements(rows);
}