"use client";
import { useEffect, useMemo, useState } from "react";
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

  async function placeOrder() {
    setMsg("Placing order…");
    const res = await fetch("/api/storefront/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_slug: slug, customer_name: name, customer_phone: phone, fulfillment,
        items: Object.entries(cart).filter(([, q]) => q > 0).map(([product_id, qty]) => ({ product_id, qty })),
      }),
    });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error ?? "Order failed"); return; }
    setMsg(`Order ${j.order_no} placed. Total KSh ${Number(j.total_due).toFixed(2)}. Pay on collection or via M-Pesa at the shop.`);
    setCart({});
  }

  if (!slug) return <div className="rounded-xl border bg-white p-6"><h1 className="text-xl font-bold">Cart</h1><p className="text-sm text-slate-600">Open this page as <code>/cart?shop=your-slug</code> from a storefront.</p></div>;

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Order from {slug}</h1>
      <div className="grid gap-2">
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded border bg-white p-3">
            <div><p className="font-medium">{p.name}</p><p className="text-sm text-slate-600">KSh {Number(p.selling_price).toFixed(2)}</p></div>
            <div className="flex items-center gap-2">
              <button className="rounded border px-2" onClick={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))}>−</button>
              <span className="w-6 text-center">{cart[p.id] ?? 0}</span>
              <button className="rounded border px-2" onClick={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}>+</button>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-white p-4">
        <p className="font-bold">Total: KSh {total.toFixed(2)}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input placeholder="Your name" className="rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Phone 07XXXXXXXX" className="rounded border px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="mt-2 flex gap-2 text-sm">
          {(["pickup", "delivery"] as const).map((f) => (
            <button key={f} onClick={() => setFulfillment(f)} className={`rounded border px-3 py-1 ${fulfillment === f ? "bg-sky-600 text-white" : ""}`}>{f}</button>
          ))}
        </div>
        <button disabled={total <= 0} onClick={placeOrder} className="mt-3 rounded bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-40">Place order</button>
        {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
      </div>
    </div>
  );
}
