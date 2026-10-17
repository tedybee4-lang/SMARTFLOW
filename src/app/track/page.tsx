"use client";
import { useState } from "react";
import { normalizeKEPhone } from "@/lib/kenya";

type Order = { order_no: string; status: string; payment_status: string; total_due: number; amount_paid: number; fulfillment: string; created_at: string };

export default function TrackPage() {
  const [phone, setPhone] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [msg, setMsg] = useState("");

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setMsg("Looking up…");
    if (!normalizeKEPhone(phone)) { setMsg("Invalid Kenyan phone number."); return; }
    const res = await fetch(`/api/storefront/track?phone=${encodeURIComponent(phone)}&order_no=${encodeURIComponent(orderNo)}`);
    const j = await res.json();
    if (!res.ok) { setMsg(j.error ?? "Lookup failed"); setOrders([]); return; }
    setOrders(j.orders ?? []);
    setMsg(j.orders?.length ? "" : "No matching orders found.");
  }

  const STEPS = ["placed", "processing", "ready", "dispatched", "delivered"];
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <h1 className="text-2xl font-bold">Track your order</h1>
      <form onSubmit={lookup} className="grid gap-2 rounded-xl border bg-white p-4">
        <input required placeholder="Phone 07XXXXXXXX" className="rounded border px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input placeholder="Order number (optional)" className="rounded border px-3 py-2" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
        <button className="rounded bg-sky-600 px-4 py-2 font-medium text-white">Track</button>
      </form>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
      {orders.map((o) => (
        <div key={o.order_no} className="rounded-xl border bg-white p-4">
          <p className="font-bold">{o.order_no}</p>
          <p className="text-sm text-slate-600">Status: {o.status} · Payment: {o.payment_status} · {o.fulfillment}</p>
          <p className="text-sm">KSh {Number(o.total_due).toFixed(2)} (paid KSh {Number(o.amount_paid).toFixed(2)})</p>
          <div className="mt-2 flex gap-1">
            {STEPS.map((s) => (
              <span key={s} className={`h-2 flex-1 rounded ${STEPS.indexOf(s) <= STEPS.indexOf(o.status) ? "bg-sky-600" : "bg-slate-200"}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
