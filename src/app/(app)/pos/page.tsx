"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

type Product = { id: string; name: string; selling_price: number; barcode: string | null };
type CartLine = { product: Product; qty: number };

export default function POSPage() {
  const [businessId, setBusinessId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: ms } = await sb.from("memberships").select("business_id").limit(1);
      const bid = (ms?.[0] as unknown as { business_id: string } | undefined)?.business_id;
      if (!bid) { setMsg("No business found — complete onboarding first."); return; }
      setBusinessId(bid);
      const { data } = await sb.from("products").select("id,name,selling_price,barcode").eq("business_id", bid).eq("is_active", true).limit(100);
      setProducts((data ?? []) as Product[]);
    })();
  }, []);

  const add = (p: Product) => setCart((c) => {
    const f = c.find((l) => l.product.id === p.id);
    return f ? c.map((l) => l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l) : [...c, { product: p, qty: 1 }];
  });
  const setQty = (id: string, delta: number) => setCart((c) =>
    c.map((l) => l.product.id === id ? { ...l, qty: Math.max(0, l.qty + delta) } : l).filter((l) => l.qty > 0)
  );
  const total = cart.reduce((s, l) => s + l.qty * Number(l.product.selling_price), 0);
  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode ?? "").includes(search));

  async function checkout(method: "cash" | "offline" | "credit") {
    setBusy(true);
    setMsg("Recording sale…");
    const res = await fetch("/api/sales/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: businessId,
        items: cart.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_price: Number(l.product.selling_price), discount: 0 })),
        payment_method: method, amount_paid: method === "cash" ? total : 0,
      }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setMsg(j.error ?? "Checkout failed"); return; }
    setMsg(`Sale recorded: ${j.order_no} — KSh ${Number(j.totalDue).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`);
    setCart([]);
  }
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Products pane */}
      <div className="lg:col-span-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Point of sale</h1>
            <p className="page-sub">{filtered.length} of {products.length} products</p>
          </div>
        </div>
        <div className="card mt-4 p-4">
          <label htmlFor="pos-search" className="sr-only">Search products or scan barcode</label>
          <input
            id="pos-search"
            className="input"
            placeholder="🔍 Search products or scan barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => add(p)}
                className="rounded-xl border border-slate-200 bg-white p-3.5 text-left transition-all hover:border-blue-400 hover:shadow-sm active:scale-[0.98]"
              >
                <p className="truncate font-semibold text-navy-900">{p.name}</p>
                <p className="num mt-0.5 text-sm font-medium text-blue-700">KSh {Number(p.selling_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</p>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
                No products match. Add products first from the Products page.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cart pane */}
      <div className="lg:col-span-2">
        <div className="card sticky top-6 flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
            <h2 className="font-bold text-navy-900">Current sale</h2>
            <p className="text-sm text-slate-500">{cart.reduce((s, l) => s + l.qty, 0)} item{cart.reduce((s, l) => s + l.qty, 0) === 1 ? "" : "s"}</p>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-3">
            <div className="grid gap-2">
              {cart.map((l) => (
                <div key={l.product.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-navy-900">{l.product.name}</p>
                    <p className="num text-xs text-slate-500">KSh {(l.qty * Number(l.product.selling_price)).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" className="btn-outline h-7 w-7 !p-0" aria-label={`Reduce ${l.product.name}`} onClick={() => setQty(l.product.id, -1)}>−</button>
                    <span className="num w-6 text-center font-semibold">{l.qty}</span>
                    <button type="button" className="btn-outline h-7 w-7 !p-0" aria-label={`Increase ${l.product.name}`} onClick={() => setQty(l.product.id, 1)}>+</button>
                  </div>
                </div>
              ))}
              {cart.length === 0 && (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">
                  Tap products to add them to the sale.
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-600">Total</p>
              <p className="num text-2xl font-bold text-navy-900">KSh {total.toLocaleString("en-KE", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="mt-4 grid gap-2">
              <button disabled={cart.length === 0 || busy} onClick={() => checkout("cash")} className="btn-primary py-3">
                💵 Cash sale — receive {formatShort(total)}
              </button>
              <button disabled={cart.length === 0 || busy} onClick={() => checkout("credit")} className="btn-outline">
                Record as credit (unpaid)
              </button>
            </div>
            {msg && <p className={`mt-3 text-sm font-medium ${msg.startsWith("Sale recorded") ? "text-emerald-700" : "text-slate-600"}`}>{msg}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatShort(n: number) {
  return `KSh ${n.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
}