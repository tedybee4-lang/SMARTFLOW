import Link from "next/link";
import { isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import AdminConsoles from "./consoles";

export const dynamic = "force-dynamic";

export default async function PlatformAdminPage() {
  if (!(await isPlatformAdmin())) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="page-title">Platform admin only</h1>
        <p className="page-sub">This area requires a platform admin account.</p>
        <Link href="/dashboard" className="btn-outline mt-5">Back to dashboard</Link>
      </div>
    );
  }
  const sb = supabaseServiceRole();
  const [b, i, a, biz, tiers, audit] = await Promise.all([
    sb.from("businesses").select("id", { count: "exact", head: true }),
    sb.from("subscription_invoices").select("id", { count: "exact", head: true }),
    sb.from("payment_attempts").select("id", { count: "exact", head: true }),
    sb.from("businesses").select("id,name,slug,subscription_status").order("created_at", { ascending: false }).limit(50),
    sb.from("subscription_plans").select("name,fee").eq("is_active", true).order("fee"),
    sb.from("audit_logs").select("action,entity,created_at").order("created_at", { ascending: false }).limit(20),
  ]);
  const counts = { businesses: b.count ?? 0, invoices: i.count ?? 0, attempts: a.count ?? 0 };
  const statCards: Array<[string, number, string]> = [
    ["Businesses", counts.businesses, "from-blue-600"],
    ["Subscription invoices", counts.invoices, "from-violet-600"],
    ["Payment attempts", counts.attempts, "from-navy-800"],
  ];
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">Platform admin</h1>
        <p className="page-sub">Global view across all SMARTFLOW businesses · Service-role access.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {statCards.map(([t, v, grad]) => (
          <div key={t} className="card overflow-hidden">
            <div className={`h-1 w-full bg-gradient-to-r ${grad}`} aria-hidden="true" />
            <div className="p-5">
              <p className="text-sm font-medium text-slate-500">{t}</p>
              <p className="num mt-1.5 text-3xl font-bold text-navy-900">{v}</p>
            </div>
          </div>
        ))}
      </div>

      <AdminConsoles />

      <section className="card p-5">
        <h2 className="font-bold text-navy-900">Subscription tiers</h2>
        <div className="mt-3 divide-y divide-slate-100">
          {((tiers.data ?? []) as { name: string; fee: number }[]).map((t) => (
            <div key={t.name} className="flex items-center justify-between py-2.5 text-sm">
              <span className="font-medium text-navy-900">{t.name}</span>
              <span className="num font-semibold text-blue-700">KSh {Number(t.fee).toLocaleString("en-KE", { minimumFractionDigits: 2 })}/mo</span>
            </div>
          ))}
          {(tiers.data ?? []).length === 0 && <p className="py-2 text-sm text-slate-500">No active plans.</p>}
        </div>
      </section>

      <section className="card overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-bold text-navy-900">Businesses <span className="text-slate-400">({counts.businesses})</span></h2>
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Storefront slug</th>
              <th>Subscription</th>
            </tr>
          </thead>
          <tbody>
            {((biz.data ?? []) as { id: string; name: string; slug: string; subscription_status: string }[]).map((x) => (
              <tr key={x.id}>
                <td className="font-medium text-navy-900">{x.name}</td>
                <td className="text-slate-600">/s/{x.slug}</td>
                <td>
                  <span className={x.subscription_status === "active" ? "badge-ok" : x.subscription_status === "trial" ? "badge-info" : "badge-warn"}>
                    {x.subscription_status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(biz.data ?? []).length === 0 && (
          <p className="border-t border-slate-100 p-6 text-center text-sm text-slate-500">No businesses registered yet.</p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="font-bold text-navy-900">Recent audit events</h2>
        <div className="mt-3 divide-y divide-slate-100">
          {((audit.data ?? []) as { action: string; entity: string; created_at: string }[]).map((e, n) => (
            <div key={n} className="flex items-center justify-between py-2 text-sm">
              <span className="text-navy-900">{e.action} <span className="text-slate-400">({e.entity})</span></span>
              <span className="text-xs text-slate-400">{new Date(e.created_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}</span>
            </div>
          ))}
          {(audit.data ?? []).length === 0 && <p className="py-2 text-sm text-slate-500">No audit events yet.</p>}
        </div>
      </section>
    </div>
  );
}