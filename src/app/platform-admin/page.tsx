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
      <section className="rounded-xl border bg-white p-5">
        <h2 className="font-bold">Subscription tiers</h2>
        <div className="mt-2 grid gap-1 text-sm">
          {((tiers.data ?? []) as { name: string; fee: number }[]).map((t) => (
            <p key={t.name} className="flex justify-between border-b py-1"><span>{t.name}</span><span className="font-medium">KSh {Number(t.fee).toFixed(2)}/mo</span></p>
          ))}
        </div>
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="font-bold">Businesses</h2>
        <div className="mt-2 grid gap-1 text-sm">
          {((biz.data ?? []) as { id: string; name: string; slug: string; subscription_status: string }[]).map((x) => (
            <p key={x.id} className="border-b py-1">{x.name} · {x.slug} · {x.subscription_status}</p>
          ))}
          {(biz.data ?? []).length === 0 && <p className="text-slate-500">No businesses registered yet.</p>}
        </div>
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="font-bold">Recent audit events</h2>
        <div className="mt-2 grid gap-1 text-sm text-slate-600">
          {((audit.data ?? []) as { action: string; entity: string; created_at: string }[]).map((e, n) => (
            <p key={n}>{e.action} ({e.entity})</p>
          ))}
        </div>
      </section>
    </div>
  );
}
