"use client";
import { useState } from "react";
import { normalizeKEPhone } from "@/lib/kenya";

type Order = { order_no: string; status: string; payment_status: string; total_due: number; amount_paid: number; fulfillment: string; created_at: string };

export default function TrackPage() {
  const [phone, setPhone] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("Looking up…");
    if (!normalizeKEPhone(phone)) { setMsg("Invalid Kenyan phone number."); setBusy(false); return; }
    const res = await fetch(`/api/storefront/track?phone=${encodeURIComponent(phone)}&order_no=${encodeURIComponent(orderNo)}`);
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setMsg(j.error ?? "Lookup failed"); setOrders([]); return; }
    setOrders(j.orders ?? []);
    setMsg(j.orders?.length ? "" : "No matching orders found.");
  }

  const STEPS = ["placed", "processing", "ready", "dispatched", "delivered"];
  return (
    <div className="mx-auto grid max-w-lg gap-6 px-4 py-12 sm:py-16">
      <div>
        <h1 className="page-title">Track your order</h1>
        <p className="page-sub">Enter the phone number you ordered with.</p>
      </div>
      <form onSubmit={lookup} className="card grid gap-4 p-6">
        <div>
          <label htmlFor="phone" className="label">Phone number</label>
          <input id="phone" required placeholder="07XXXXXXXX" className="input mt-1.5" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ono" className="label">Order number <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="ono" placeholder="e.g. SF-20261018-0001" className="input mt-1.5" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className="btn-primary py-3">
          {busy ? "Looking up…" : "Track order"}
        </button>
      </form>
      {msg && <p className="hint text-center">{msg}</p>}
      <div className="grid gap-4">
        {orders.map((o) => {
          const idx = STEPS.indexOf(o.status);
          const paidInFull = Number(o.amount_paid) >= Number(o.total_due);
          return (
            <div key={o.order_no} className="card p-5">
              <div className="flex items-center justify-between">
                <p className="font-bold text-navy-900">{o.order_no}</p>
                <span className={paidInFull ? "badge-ok" : "badge-warn"}>
                  {paidInFull ? "Paid" : "Balance due"}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {o.fulfillment === "delivery" ? "Delivery" : "Pickup"} · Placed {new Date(o.created_at).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" })}
              </p>
              <p className="mt-2 text-sm">
                <span className="num font-semibold">KSh {Number(o.total_due).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</span>
                <span className="text-slate-500"> · paid KSh {Number(o.amount_paid).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</span>
              </p>
              <div className="mt-4" aria-label={`Order status: ${o.status}`}>
                <div className="flex gap-1">
                  {STEPS.map((s, i) => (
                    <span key={s} className={`h-2 flex-1 rounded ${i <= idx ? "bg-blue-600" : "bg-slate-200"}`} />
                  ))}
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] capitalize text-slate-500">
                  {STEPS.map((s) => (
                    <span key={s} className={STEPS.indexOf(s) === idx ? "font-semibold text-blue-700" : ""}>{s}</span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
