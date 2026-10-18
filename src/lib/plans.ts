import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Subscription plan shape shown on the public pricing section. */
export type PublicPlan = {
  code: string;
  name: string;
  price_kes_per_month: number;
  monthly_sales_min: number;
  monthly_sales_max: number | null;
  max_staff: number | null;
  max_products: number | null;
  priority_support: boolean;
};

/**
 * Fallback list mirroring the real configuration seeded by
 * `supabase/migrations/20261017000004_billing.sql` (applied to the production
 * database). Used only when the live `subscription_plans` table cannot be
 * read at runtime/build time. Prices are never invented — these ARE the
 * configured values from the migration.
 */
export const FALLBACK_PLANS: PublicPlan[] = [
  { code: "starter", name: "Starter", price_kes_per_month: 4000, monthly_sales_min: 0, monthly_sales_max: 50000, max_staff: 2, max_products: 200, priority_support: false },
  { code: "growth", name: "Growth", price_kes_per_month: 6000, monthly_sales_min: 50000, monthly_sales_max: 200000, max_staff: 5, max_products: 1000, priority_support: false },
  { code: "scale", name: "Scale", price_kes_per_month: 9000, monthly_sales_min: 200000, monthly_sales_max: 500000, max_staff: 10, max_products: 5000, priority_support: false },
  { code: "pro", name: "Pro", price_kes_per_month: 12000, monthly_sales_min: 500000, monthly_sales_max: 1000000, max_staff: null, max_products: 20000, priority_support: true },
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Read active plans from the database (service role; bypasses RLS) and map the
 * real `subscription_plans` columns (`name`, `fee`, `max_qualifying_sales`) to
 * the public plan shape. Falls back to FALLBACK_PLANS when the table is
 * unavailable (e.g. no service role key locally).
 */
export async function getPublicPlans(): Promise<PublicPlan[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return FALLBACK_PLANS;
  try {
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await sb
      .from("subscription_plans")
      .select("name, fee, max_qualifying_sales, is_active")
      .eq("is_active", true)
      .order("fee", { ascending: true })
      .limit(10);
    if (error || !data || data.length === 0) return FALLBACK_PLANS;

    let previousMax: number | null = null;
    return data.map((row) => {
      const min = previousMax ?? 0;
      const max = row.max_qualifying_sales == null ? null : Number(row.max_qualifying_sales);
      previousMax = max;
      return {
        code: slugify(row.name),
        name: row.name,
        price_kes_per_month: row.fee == null ? 0 : Number(row.fee),
        monthly_sales_min: min,
        monthly_sales_max: max,
        max_staff: null,
        max_products: null,
        priority_support: /pro\b/i.test(row.name),
      };
    });
  } catch {
    return FALLBACK_PLANS;
  }
}

/** "KSh 4,000" style short price for marketing cards. */
export function formatPlanPrice(n: number): string {
  return "KSh " + Math.round(n).toLocaleString("en-KE");
}