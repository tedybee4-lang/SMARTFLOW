import Link from "next/link";
import { currentUser, requireMembership } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { formatKES } from "@/lib/kenya";
import { evaluateSubscription, blockedMessage } from "@/lib/trial";
import { aggregateDailySales, topProducts, pctChange } from "@/lib/analytics";

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
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [{ data: orders }, { data: expenses }, { data: sub }, { data: weekOrders }, { data: recent }] = await Promise.all([
    sb.from("orders").select("total_due, amount_paid, status").eq("business_id", bid).gte("created_at", today),
    sb.from("expenses").select("amount").eq("business_id", bid).eq("spent_at", today),
    sb.from("subscriptions").select("status, trial_started_at, trial_ends_at, current_period_end, subscription_plans(grace_days)").eq("business_id", bid).maybeSingle(),
    sb.from("orders").select("id, created_at, total_due").eq("business_id", bid).gte("created_at", weekAgo).limit(500),
    sb.from("orders").select("id, order_no, status, payment_status, total_due, amount_paid, created_at").eq("business_id", bid).order("created_at", { ascending: false }).limit(5),
  ]);
  // order_items for the top-products panel (needs the week's order ids)
  const weekOrderRows = (weekOrders ?? []) as Array<{ id: string; created_at: string; total_due: number }>;
  const ids = weekOrderRows.map((r) => r.id);
  const { data: weekItems } = ids.length
    ? await sb.from("order_items").select("name_snapshot, qty, line_total").in("order_id", ids).limit(2000)
    : { data: [] as unknown[] };
  const subEval = evaluateSubscription(
    (sub ?? null) as unknown as Parameters<typeof evaluateSubscription>[0],
    new Date(),
  );
  const trialBanner =
    subEval.state === "trial" && subEval.trialDaysLeft !== null
      ? { tone: "info" as const, text: `Free trial — ${subEval.trialDaysLeft} day${subEval.trialDaysLeft === 1 ? "" : "s"} left. Choose a plan to continue selling after it ends.` }
      : !subEval.canSell
        ? { tone: "danger" as const, text: blockedMessage(subEval.state) || "Selling is currently blocked." }
        : null;
  const sales = (orders ?? []).reduce((s: number, o: { total_due: number }) => s + Number(o.total_due), 0);
  const paid = (orders ?? []).reduce((s: number, o: { amount_paid: number }) => s + Number(o.amount_paid), 0);
  const exp = (expenses ?? []).reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0);
  const cards: Array<[string, string, string]> = [
    ["Today's sales", formatKES(sales), "from-blue-600"],
    ["Cash received", formatKES(paid), "from-violet-600"],
    ["Outstanding", formatKES(sales - paid), "from-amber-500"],
    ["Expenses today", formatKES(exp), "from-navy-800"],
  ];

  // ---- Analytics (real order rows, last 7 days) ----
  const daily = aggregateDailySales(weekOrderRows, now, 7);
  const weekTotal = daily.reduce((s, d) => s + d.total, 0);
  const maxDay = Math.max(1, ...daily.map((d) => d.total));
  const delta = pctChange(daily[6]?.total ?? 0, daily[5]?.total ?? 0);
  const tops = topProducts(
    ((weekItems ?? []) as Array<{ name_snapshot: string; qty: number; line_total: number }>),
    5,
  );
  const recentRows = (recent ?? []) as Array<{
    id: string; order_no: string; status: string; payment_status: string;
    total_due: number; amount_paid: number; created_at: string;
  }>;
  const chartSummary = `Sales the last 7 days total ${formatKES(weekTotal)}; best day ${formatKES(maxDay)}.`;

  function barColor(total: number, isToday: boolean): string {
    if (total === 0) return "#e2e8f0";
    return isToday ? "#2563eb" : "#93c5fd";
  }
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{first.businesses?.name ?? "Dashboard"}</h1>
          <p className="page-sub">Role: <span className="font-medium text-navy-900">{first.role}</span> · Today · Figures from real records (no demo data).</p>
        </div>
        <Link href={`/orders?bid=${bid}`} className="btn-outline text-sm">View all orders →</Link>
      </div>

      {trialBanner && (
        <div
          className={`card p-4 text-sm font-medium ${
            trialBanner.tone === "danger"
              ? "border border-rose-200 bg-rose-50 text-rose-800"
              : "border border-blue-200 bg-blue-50 text-blue-800"
          }`}
          role="status"
        >
          {trialBanner.text}{" "}
          <Link href="/subscriptions" className="font-semibold underline">
            View plans →
          </Link>
        </div>
      )}

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

      {/* ---- 7-day sales chart ---- */}
      <div className="card p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-navy-900">Sales — last 7 days</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Total <span className="num font-semibold text-navy-900">{formatKES(weekTotal)}</span>
              {delta !== null && (
                <span className={`ml-2 text-xs font-semibold ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs yesterday
                </span>
              )}
            </p>
          </div>
          <Link href={`/orders?bid=${bid}`} className="text-sm font-semibold text-blue-700 hover:underline">View orders →</Link>
        </div>
        <svg
          viewBox="0 0 700 220"
          className="mt-5 w-full"
          role="img"
          aria-label={chartSummary}
          preserveAspectRatio="xMidYMid meet"
        >
          <title>{chartSummary}</title>
          <line x1="0" y1="180" x2="700" y2="180" stroke="#e2e8f0" strokeWidth="1" />
          {daily.map((d, i) => {
            const h = Math.max(d.total > 0 ? 4 : 0, (d.total / maxDay) * 150);
            const x = 20 + i * 97;
            const isToday = i === 6;
            return (
              <g key={d.date}>
                <rect
                  x={x}
                  y={180 - h}
                  width={56}
                  height={h}
                  rx={4}
                  fill={barColor(d.total, isToday)}
                >
                  <title>{`${d.date}: ${formatKES(d.total)}`}</title>
                </rect>
                <text x={x + 28} y={200} textAnchor="middle" fontSize="13" fill={isToday ? "#1e3a8a" : "#64748b"} fontWeight={isToday ? 700 : 500}>
                  {d.label}
                </text>
                <text x={x + 28} y={180 - h - 6} textAnchor="middle" fontSize="11" fill="#94a3b8">
                  {d.total > 0 ? formatKES(d.total).replace(/\.00$/, "") : ""}
                </text>
              </g>
            );
          })}
        </svg>
        <table className="sr-only">
          <caption>Daily sales, last 7 days</caption>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date}><th scope="row">{d.date}</th><td>{formatKES(d.total)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- Top products + recent orders ---- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-base font-semibold text-navy-900">Top products — 7 days</h2>
          {tops.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No sales in the last 7 days yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {tops.map((p, i) => (
                <li key={p.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{i + 1}</span>
                    <span className="font-medium text-navy-900">{p.name}</span>
                    <span className="text-xs text-slate-400">× {p.qty}</span>
                  </span>
                  <span className="num font-semibold text-navy-900">{formatKES(p.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-navy-900">Recent orders</h2>
            <Link href={`/orders?bid=${bid}`} className="text-sm font-semibold text-blue-700 hover:underline">All orders →</Link>
          </div>
          {recentRows.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No orders yet — your latest sales will appear here.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {recentRows.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium text-navy-900">{o.order_no}</span>
                    <span className="block text-xs text-slate-400">{new Date(o.created_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      o.payment_status === "paid" ? "bg-emerald-50 text-emerald-700"
                        : o.payment_status === "partial" ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-600"}`}>
                      {o.payment_status}
                    </span>
                    <span className="num font-semibold text-navy-900">{formatKES(Number(o.total_due))}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
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