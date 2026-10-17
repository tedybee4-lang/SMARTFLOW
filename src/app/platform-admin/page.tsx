import { isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function PlatformAdminPage() {
  if (!(await isPlatformAdmin())) {
    return (
      <div className="rounded-xl border bg-white p-6">
        <h1 className="text-xl font-bold">Platform admin only</h1>
        <p className="text-sm text-slate-600">This area requires a platform admin account.</p>
      </div>
    );
  }
  let counts = { businesses: 0, invoices: 0, attempts: 0 };
  try {
    const sb = supabaseServiceRole();
    const [b, i, a] = await Promise.all([
      sb.from("businesses").select("id", { count: "exact", head: true }),
      sb.from("subscription_invoices").select("id", { count: "exact", head: true }),
      sb.from("payment_attempts").select("id", { count: "exact", head: true }),
    ]);
    counts = { businesses: b.count ?? 0, invoices: i.count ?? 0, attempts: a.count ?? 0 };
  } catch { /* env not configured yet */ }
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">Platform admin</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {[["Businesses", counts.businesses], ["Subscription invoices", counts.invoices], ["Payment attempts", counts.attempts]].map(([t, v]) => (
          <div key={t as string} className="rounded-xl border bg-white p-5">
            <p className="text-sm text-slate-500">{t}</p>
            <p className="text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-600">Full management (tiers, arrears, reconciliation, audit) ships in Phase 6 against live data.</p>
    </div>
  );
}
