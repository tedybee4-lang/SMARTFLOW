import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { formatKES } from "@/lib/kenya";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  placed: "badge-info",
  processing: "badge-warn",
  ready: "badge-info",
  dispatched: "badge-neutral",
  delivered: "badge-ok",
  cancelled: "badge-err",
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ bid?: string }> }) {
  const { bid: paramBid } = await searchParams;
  const sb = await supabaseServer();
  let bid = paramBid;
  if (!bid) {
    const { data: ms } = await sb.from("memberships").select("business_id").limit(1);
    bid = (ms?.[0] as unknown as { business_id: string } | undefined)?.business_id;
  }
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
  const { data: orders } = await sb.from("orders").select("id,order_no,status,payment_status,total_due,amount_paid,created_at").eq("business_id", bid).order("created_at", { ascending: false }).limit(100);
  const rows = (orders ?? []) as Array<{ id: string; order_no: string; status: string; payment_status: string; total_due: number; amount_paid: number; created_at: string }>;
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">Orders</h1>
        <p className="page-sub">{rows.length} order{rows.length === 1 ? "" : "s"} · newest first · pay via M-Pesa at the counter or on delivery.</p>
      </div>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Order</th>
              <th>Status</th>
              <th>Payment</th>
              <th className="text-right">Due</th>
              <th className="text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const settled = Number(o.amount_paid) >= Number(o.total_due);
              return (
                <tr key={o.id}>
                  <td>
                    <p className="font-medium text-navy-900">{o.order_no}</p>
                    <p className="text-xs text-slate-400">{new Date(o.created_at).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" })}</p>
                  </td>
                  <td><span className={STATUS_BADGE[o.status] ?? "badge-neutral"}>{o.status}</span></td>
                  <td>
                    <span className={o.payment_status === "paid" ? "badge-ok" : o.payment_status === "partial" ? "badge-warn" : "badge-err"}>
                      {o.payment_status}
                    </span>
                  </td>
                  <td className="num text-right font-semibold text-navy-900">{formatKES(Number(o.total_due))}</td>
                  <td className={`num text-right ${settled ? "text-emerald-700" : "text-slate-600"}`}>{formatKES(Number(o.amount_paid))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="border-t border-slate-100 p-6 text-center text-sm text-slate-500">
            No orders yet — make a sale from the{" "}
            <Link href="/pos" className="font-semibold text-blue-700 hover:underline">POS</Link>.
          </p>
        )}
      </div>
    </div>
  );
}