"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

type Product = { id: string; name: string; selling_price: number };

export default function CartPage() {
  const slug = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("shop") ?? "";
  }, []);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const sb = supabaseBrowser();
      const { data: biz } = await sb.from("businesses").select("id").eq("slug", slug).maybeSingle();
      const b = biz as { id: string } | null;
      if (!b) { setMsg("Shop not found."); return; }
      const { data } = await sb.from("products").select("id,name,selling_price").eq("business_id", b.id).eq("is_active", true).limit(60);
      setProducts((data ?? []) as Product[]);
    })();
  }, [slug]);

  const total = products.reduce((sum, p) => sum + (cart[p.id] ?? 0) * Number(p.selling_price), 0);
  const itemCount = Object.values(cart).reduce((s, q) => s + q, 0);

  async function placeOrder() {
    setBusy(true);
    setMsg("Placing order…");
    const res = await fetch("/api/storefront/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_slug: slug, customer_name: name, customer_phone: phone, fulfillment,
        items: Object.entries(cart).filter(([, q]) => q > 0).map(([product_id, qty]) => ({ product_id, qty })),
      }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setMsg(j.error ?? "Order failed"); return; }
    setMsg(`Order ${j.order_no} placed. Total KSh ${Number(j.total_due).toFixed(2)}. Pay on collection or via M-Pesa at the shop.`);
    setCart({});
  }

  if (!slug) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="page-title">Cart</h1>
        <p className="page-sub">
          Open this page as <code className="rounded bg-slate-100 px-1.5 py-0.5">/cart?shop=your-slug</code> from a storefront.
        </p>
        <Link href="/" className="btn-outline mt-6">Back to SMARTFLOW</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-10 sm:py-14">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Your cart</h1>
          <p className="page-sub">Ordering from <span className="font-semibold text-navy-900">{slug}</span>{itemCount > 0 ? ` · ${itemCount} item${itemCount === 1 ? "" : "s"}` : ""}</p>
        </div>
        <Link href={`/s/${slug}`} className="btn-ghost text-sm">← Shop</Link>
      </div>

      <div className="card divide-y divide-slate-100 overflow-hidden">
        {products.map((p) => {
          const qty = cart[p.id] ?? 0;
          return (
            <div key={p.id} className={`flex items-center justify-between px-4 py-3.5 transition-colors ${qty > 0 ? "bg-blue-50/50" : ""}`}>
              <div>
                <p className="font-medium text-navy-900">{p.name}</p>
                <p className="num text-sm text-slate-500">KSh {Number(p.selling_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className="btn-outline h-9 w-9 !p-0 text-lg" aria-label={`Remove one ${p.name}`} onClick={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))}>−</button>
                <span className="num w-8 text-center font-semibold">{qty}</span>
                <button type="button" className="btn-outline h-9 w-9 !p-0 text-lg" aria-label={`Add one ${p.name}`} onClick={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}>+</button>
              </div>
            </div>
          );
        })}
        {products.length === 0 && <p className="p-6 text-sm text-slate-500">Loading products…</p>}
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">Total</p>
          <p className="num text-2xl font-bold text-navy-900">KSh {total.toLocaleString("en-KE", { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="cname" className="label">Your name</label>
            <input id="cname" className="input mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Wanjiru" />
          </div>
          <div>
            <label htmlFor="cphone" className="label">Phone</label>
            <input id="cphone" className="input mt-1.5" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XXXXXXXX" />
          </div>
        </div>
        <div className="mt-4">
          <span className="label">Fulfilment</span>
          <div className="mt-1.5 flex gap-2">
            {(["pickup", "delivery"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFulfillment(f)}
                className={`btn flex-1 capitalize ${fulfillment === f ? "bg-navy-900 text-white hover:bg-navy-800" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
                aria-pressed={fulfillment === f}
              >
                {f === "pickup" ? "🏬 Pickup" : "🚚 Delivery"}
              </button>
            ))}
          </div>
        </div>
        <button type="button" disabled={total <= 0 || busy} onClick={placeOrder} className="btn-primary mt-6 w-full py-3 text-base">
          {busy ? "Placing order…" : "Place order"}
        </button>
        {msg && <p className={`mt-4 text-sm ${msg.includes("placed") ? "ok-text" : "hint"}`}>{msg}</p>}
      </div>
    </div>
  );
}