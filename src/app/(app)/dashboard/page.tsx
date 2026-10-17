import Link from "next/link";
import { currentUser, requireMembership } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { formatKES } from "@/lib/kenya";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="page-title">Sign in required</h1>
        <p className="page-sub">Please sign in to view your dashboard.</p>
        <Link href="/sign-in" className="btn-primary mt-5">Sign in</Link>
      </div>
    );
  }
  const sb = await supabaseServer();
  const { data: memberships } = await sb.from("memberships").select("business_id, role, businesses(name)").limit(10);
  const first = memberships?.[0] as unknown as { business_id: string; role: string; businesses: { name: string } } | undefined;
  if (!first) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="page-title">No business yet</h1>
        <p className="page-sub">Complete onboarding to create your business.</p>
        <Link href="/onboarding" className="btn-primary mt-5">Start onboarding</Link>
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
  const cards: Array<[string, string, string]> = [
    ["Today's sales", formatKES(sales), "from-blue-600"],
    ["Cash received", formatKES(paid), "from-violet-600"],
    ["Outstanding", formatKES(sales - paid), "from-amber-500"],
    ["Expenses today", formatKES(exp), "from-navy-800"],
  ];
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{first.businesses?.name ?? "Dashboard"}</h1>
          <p className="page-sub">Role: <span className="font-medium text-navy-900">{first.role}</span> · Today · Figures from real records (no demo data).</p>
        </div>
        <Link href={`/orders?bid=${bid}`} className="btn-outline text-sm">View all orders →</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([t, v, grad]) => (
          <div key={t} className="card overflow-hidden">
            <div className={`h-1 w-full bg-gradient-to-r ${grad}`} aria-hidden="true" />
            <div className="p-5">
              <p className="text-sm font-medium text-slate-500">{t}</p>
              <p className="num mt-1.5 text-2xl font-bold text-navy-900">{v}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {([
          ["New sale", "/pos", "🛒"],
          ["Products", "/products", "📦"],
          ["Orders", `/orders?bid=${bid}`, "🧾"],
          ["Expenses", "/expenses", "💸"],
        ] as Array<[string, string, string]>).map(([t, href, icon]) => (
          <Link key={t} href={href} className="card-pad flex items-center gap-3 transition-shadow hover:shadow-md">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-900 text-lg" aria-hidden="true">{icon}</span>
            <span className="font-semibold text-navy-900">{t}</span>
          </Link>
        ))}
      </div>

      {(orders ?? []).length === 0 && (
        <div className="card border-dashed p-8 text-center text-sm text-slate-600">
          No sales today yet. Record your first sale from the{" "}
          <Link href="/pos" className="font-semibold text-blue-700 hover:underline">POS</Link> — it will appear here and in reports.
        </div>
      )}
    </div>
  );
}