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
  const total = cart.reduce((s, l) => s + l.qty * Number(l.product.selling_price), 0);
  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode ?? "").includes(search));

  async function checkout(method: "cash" | "offline" | "credit") {
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
    if (!res.ok) { setMsg(j.error ?? "Checkout failed"); return; }
    setMsg(`Sale recorded: ${j.order_no} — KSh ${Number(j.totalDue).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`);
    setCart([]);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-xl border bg-white p-4">
        <h1 className="text-xl font-bold">Point of sale</h1>
        <input className="mt-3 w-full rounded border px-3 py-2" placeholder="Search products or scan barcode…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {filtered.map((p) => (
            <button key={p.id} onClick={() => add(p)} className="rounded border p-3 text-left hover:border-sky-500">
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-slate-600">KSh {Number(p.selling_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</p>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-sm text-slate-500">No products. Add products first.</p>}
        </div>
      </div>
      <div className="rounded-xl border bg-white p-4">
        <h2 className="font-bold">Cart ({cart.length})</h2>
        <div className="mt-2 grid gap-2">
          {cart.map((l) => (
            <div key={l.product.id} className="flex items-center justify-between text-sm">
              <span>{l.product.name} × {l.qty}</span>
              <span>KSh {(l.qty * Number(l.product.selling_price)).toFixed(2)}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-lg font-bold">Total: KSh {total.toFixed(2)}</p>
        <div className="mt-3 grid gap-2">
          <button disabled={cart.length === 0} onClick={() => checkout("cash")} className="rounded bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-40">Cash sale</button>
          <button disabled={cart.length === 0} onClick={() => checkout("credit")} className="rounded border px-4 py-2">Record as credit (unpaid)</button>
        </div>
        {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
      </div>
    </div>
  );
}
