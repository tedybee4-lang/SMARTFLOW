import { currentUser, requireMembership } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { formatKES } from "@/lib/kenya";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) {
    return (
      <div className="rounded-xl border bg-white p-6">
        <h1 className="text-xl font-bold">Sign in required</h1>
        <p className="mt-1 text-sm text-slate-600">Please <a className="text-sky-700 underline" href="/sign-in">sign in</a> to view your dashboard.</p>
      </div>
    );
  }
  const sb = await supabaseServer();
  const { data: memberships } = await sb.from("memberships").select("business_id, role, businesses(name)").limit(10);
  const first = memberships?.[0] as unknown as { business_id: string; role: string; businesses: { name: string } } | undefined;
  if (!first) {
    return (
      <div className="rounded-xl border bg-white p-6">
        <h1 className="text-xl font-bold">No business yet</h1>
        <p className="mt-1 text-sm text-slate-600">Complete <a className="text-sky-700 underline" href="/onboarding">onboarding</a> to create your business.</p>
      </div>
    );
  }
  const m = await requireMembership(first.business_id);
  if (!m) return <p>Not authorized.</p>;
  const bid = first.business_id;
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: orders }, { data: expenses }] = await Promise.all([
    sb.from("orders").select("total_due, amount_paid, status").eq("business_id", bid).gte("created_at", today),
    sb.from("expenses").select("amount").eq("business_id", bid).eq("spent_at", today),
  ]);
  const sales = (orders ?? []).reduce((s: number, o: { total_due: number }) => s + Number(o.total_due), 0);
  const paid = (orders ?? []).reduce((s: number, o: { amount_paid: number }) => s + Number(o.amount_paid), 0);
  const exp = (expenses ?? []).reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0);
  const cards: Array<[string, string]> = [
    ["Today's sales", formatKES(sales)],
    ["Cash received", formatKES(paid)],
    ["Outstanding", formatKES(sales - paid)],
    ["Expenses today", formatKES(exp)],
  ];
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">{first.businesses?.name ?? "Dashboard"}</h1>
        <p className="text-sm text-slate-600">Role: {first.role} · Figures from real records (no demo data).</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([t, v]) => (
          <div key={t} className="rounded-xl border bg-white p-5">
            <p className="text-sm text-slate-500">{t}</p>
            <p className="mt-1 text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[["New sale", "/pos"], ["Products", "/products"], ["Orders", "/orders"], ["Expenses", "/expenses"]].map(([t, href]) => (
          <a key={t} href={href} className="rounded-lg bg-[#0a1633] px-4 py-3 text-center text-sm font-medium text-white hover:bg-sky-700">{t}</a>
        ))}
      </div>
      {(orders ?? []).length === 0 && (
        <div className="rounded-xl border border-dashed bg-white p-6 text-sm text-slate-600">
          No sales today yet. Record your first sale from the POS — it will appear here and in reports.
        </div>
      )}
    </div>
  );
}
