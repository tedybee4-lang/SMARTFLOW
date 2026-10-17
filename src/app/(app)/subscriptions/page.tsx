import Link from "next/link";
import { currentUser, requireMembership } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { formatKES } from "@/lib/kenya";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const user = await currentUser();
  if (!user) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="page-title">Sign in required</h1>
        <p className="page-sub">Please sign in to view your subscription.</p>
        <Link href="/sign-in" className="btn-primary mt-5">Sign in</Link>
      </div>
    );
  }
  const sb = await supabaseServer();
  const { data: ms } = await sb.from("memberships").select("business_id").limit(1);
  const bid = (ms?.[0] as unknown as { business_id: string } | undefined)?.business_id;
  if (!bid) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="page-title">No business yet</h1>
        <p className="page-sub">Complete onboarding to create your business.</p>
        <Link href="/onboarding" className="btn-primary mt-5">Start onboarding</Link>
      </div>
    );
  }
  const m = await requireMembership(bid);
  if (!m) return <p>Not authorized.</p>;

  const [{ data: sub }, { data: plans }, { data: invoices }] = await Promise.all([
    sb.from("subscriptions").select("status, qualifying_sales, current_period_start, current_period_end, subscription_plans(name, fee, max_qualifying_sales, grace_days)").eq("business_id", bid).maybeSingle(),
    sb.from("subscription_plans").select("id, name, max_qualifying_sales, fee, grace_days").eq("is_active", true).order("fee").limit(10),
    sb.from("subscription_invoices").select("id, period_start, period_end, qualifying_sales, amount, status, due_date").eq("business_id", bid).order("created_at", { ascending: false }).limit(12),
  ]);
  const s = sub as {
    status: string; qualifying_sales: number; current_period_start: string | null; current_period_end: string | null;
    subscription_plans: { name: string; fee: number; max_qualifying_sales: number | null; grace_days: number } | null;
  } | null;
  const planList = (plans ?? []) as Array<{ id: string; name: string; max_qualifying_sales: number | null; fee: number; grace_days: number }>;
  const invoiceList = (invoices ?? []) as Array<{ id: string; period_start: string; period_end: string; qualifying_sales: number; amount: number; status: string; due_date: string | null }>;
  const activeName = s?.subscription_plans?.name ?? null;

  const statusBadge = (st: string) =>
    st === "active" ? "badge-ok" : st === "trial" ? "badge-info" : st === "suspended" || st === "cancelled" ? "badge-err" : "badge-warn";
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">Subscription</h1>
        <p className="page-sub">Plans are based on your qualifying monthly sales. Prices in KSh, billed monthly.</p>
      </div>

      {/* Current subscription */}
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-r from-navy-900 via-navy-800 to-blue-900 px-6 py-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-blue-300">Current plan</p>
              <p className="text-2xl font-bold">{s?.subscription_plans?.name ?? "No plan yet"}</p>
            </div>
            {s && <span className={`${statusBadge(s.status)} border-blue-400/40 bg-blue-400/10 text-blue-200`}>{s.status}</span>}
          </div>
        </div>
        <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
          <div>
            <p className="text-sm text-slate-500">Monthly fee</p>
            <p className="num mt-1 text-lg font-bold text-navy-900">{s?.subscription_plans ? formatKES(Number(s.subscription_plans.fee)) : "—"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Qualifying sales this period</p>
            <p className="num mt-1 text-lg font-bold text-navy-900">{formatKES(Number(s?.qualifying_sales ?? 0))}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Current period</p>
            <p className="mt-1 text-lg font-bold text-navy-900">
              {s?.current_period_start && s?.current_period_end
                ? `${new Date(s.current_period_start).toLocaleDateString("en-KE")} – ${new Date(s.current_period_end).toLocaleDateString("en-KE")}`
                : "—"}
            </p>
          </div>
        </div>
      </div>
      {/* Plans */}
      <div>
        <h2 className="text-lg font-bold text-navy-900">Available plans</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {planList.map((p) => {
            const current = p.name === activeName;
            return (
              <div key={p.id} className={`card flex flex-col p-5 ${current ? "border-blue-500 ring-1 ring-blue-500" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-navy-900">{p.name}</p>
                  {current && <span className="badge-info shrink-0">Current</span>}
                </div>
                <p className="num mt-3 text-2xl font-bold text-navy-900">{formatKES(Number(p.fee))}</p>
                <p className="text-sm text-slate-500">per month</p>
                <div className="mt-4 space-y-1.5 text-sm text-slate-600">
                  <p>· Qualifying sales up to {formatKES(Number(p.max_qualifying_sales))}</p>
                  <p>· {p.grace_days}-day grace period</p>
                </div>
              </div>
            );
          })}
          {planList.length === 0 && <p className="text-sm text-slate-500">No plans available.</p>}
        </div>
      </div>

      {/* Invoices */}
      <div>
        <h2 className="text-lg font-bold text-navy-900">Recent invoices</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Period</th>
                <th className="text-right">Qualifying sales</th>
                <th className="text-right">Amount</th>
                <th>Due date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoiceList.map((inv) => (
                <tr key={inv.id}>
                  <td className="text-navy-900">{new Date(inv.period_start).toLocaleDateString("en-KE")} – {new Date(inv.period_end).toLocaleDateString("en-KE")}</td>
                  <td className="num text-right text-slate-600">{formatKES(Number(inv.qualifying_sales ?? 0))}</td>
                  <td className="num text-right font-semibold text-navy-900">{formatKES(Number(inv.amount))}</td>
                  <td className="text-slate-600">{inv.due_date ? new Date(inv.due_date).toLocaleDateString("en-KE") : "—"}</td>
                  <td>
                    <span className={inv.status === "paid" ? "badge-ok" : inv.status === "unpaid" ? "badge-warn" : "badge-err"}>{inv.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoiceList.length === 0 && (
            <p className="border-t border-slate-100 p-6 text-center text-sm text-slate-500">
              No invoices yet — your first invoice is generated after your qualifying sales are assessed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}