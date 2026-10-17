import { requireMembership } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { formatKES } from "@/lib/kenya";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ bid?: string }> }) {
  const { bid } = await searchParams;
  if (!bid) return <p className="text-sm">Open from dashboard with a business context.</p>;
  const m = await requireMembership(bid);
  if (!m) return <p>Not authorized.</p>;
  const sb = await supabaseServer();
  const { data: orders } = await sb.from("orders").select("id,order_no,status,payment_status,total_due,amount_paid,created_at").eq("business_id", bid).order("created_at", { ascending: false }).limit(100);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Orders</h1>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500"><th className="p-3">Order</th><th className="p-3">Status</th><th className="p-3">Payment</th><th className="p-3">Due</th><th className="p-3">Paid</th></tr></thead>
          <tbody>{(orders ?? []).map((o: { id: string; order_no: string; status: string; payment_status: string; total_due: number; amount_paid: number }) => (
            <tr key={o.id} className="border-b"><td className="p-3 font-medium">{o.order_no}</td><td className="p-3">{o.status}</td><td className="p-3">{o.payment_status}</td><td className="p-3">{formatKES(Number(o.total_due))}</td><td className="p-3">{formatKES(Number(o.amount_paid))}</td></tr>
          ))}</tbody>
        </table>
        {(orders ?? []).length === 0 && <p className="p-4 text-sm text-slate-500">No orders yet — make a sale from the POS.</p>}
      </div>
    </div>
  );
}
