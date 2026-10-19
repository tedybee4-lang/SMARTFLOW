"use client";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

type Product = { id: string; name: string; selling_price: number; barcode: string | null; track_stock: boolean; category_id: string | null };
type CartLine = { product: Product; qty: number; discount: number };
type Category = { id: string; name: string };
// Snapshot of a completed sale, kept only long enough to print a receipt.
type Receipt = {
  orderNo: string;
  method: string;
  total: number;
  at: string;
  lines: { name: string; qty: number; unitPrice: number; discount: number; lineTotal: number }[];
};

export default function POSPage() {
  const [businessId, setBusinessId] = useState("");
  const [role, setRole] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Map<string, number>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [clientRef, setClientRef] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // PayHero M-Pesa collection channel configured for this business (if any).
  const [payheroChannel, setPayheroChannel] = useState("");
  const [stkPhone, setStkPhone] = useState("");

  const canDiscount = role === "owner" || role === "manager";

  async function refreshStock(bid: string) {
    const sb = supabaseBrowser();
    const { data } = await sb.from("stock_movements")
      .select("product_id,quantity_delta").eq("business_id", bid).limit(5000);
    const rows = (data ?? []) as { product_id: string; quantity_delta: number }[];
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(r.product_id, (m.get(r.product_id) ?? 0) + Number(r.quantity_delta));
    }
    setStock(m);
  }

  function newSale() {
    // One idempotency key per sale attempt — double-taps/retries dedupe server-side.
    setClientRef(`pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: ms } = await sb.from("memberships").select("business_id,role").limit(1);
      const row = (ms?.[0] as unknown as { business_id: string; role: string } | undefined);
      if (!row) { setErr("No business found — complete onboarding first."); return; }
      setBusinessId(row.business_id);
      setRole(row.role);
      newSale();
      const [prods, cats, chans] = await Promise.all([
        sb.from("products").select("id,name,selling_price,barcode,track_stock,category_id")
          .eq("business_id", row.business_id).eq("is_active", true).limit(100),
        sb.from("categories").select("id,name").eq("business_id", row.business_id).order("name"),
        sb.from("business_payment_channels").select("payment_method,channel_id,is_active")
          .eq("business_id", row.business_id).maybeSingle(),
      ]);
      setProducts((prods.data ?? []) as Product[]);
      setCategories((cats.data ?? []) as Category[]);
      const ch = chans.data as { payment_method: string; channel_id: string | null; is_active: boolean } | null;
      if (ch?.is_active && ch.payment_method === "payhero" && ch.channel_id) setPayheroChannel(ch.channel_id);
      // Current stock from the ledger (RLS: members read their own stock rows).
      await refreshStock(row.business_id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = (p: Product) => setCart((c) => {
    const f = c.find((l) => l.product.id === p.id);
    return f ? c.map((l) => l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l) : [...c, { product: p, qty: 1, discount: 0 }];
  });
  const setQty = (id: string, delta: number) => setCart((c) =>
    c.map((l) => l.product.id === id ? { ...l, qty: Math.max(0, l.qty + delta) } : l).filter((l) => l.qty > 0)
  );
  const removeLine = (id: string) => setCart((c) => c.filter((l) => l.product.id !== id));
  const setLineDiscount = (id: string, value: number) => setCart((c) =>
    c.map((l) => l.product.id === id ? { ...l, discount: Math.max(0, value) } : l)
  );

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.qty * Number(l.product.selling_price), 0), [cart]);
  const lineDiscounts = cart.reduce((s, l) => s + l.discount, 0);
  const total = Math.max(0, subtotal - lineDiscounts - (canDiscount ? orderDiscount : 0));
  const filtered = products.filter((p) =>
    (!categoryId || p.category_id === categoryId) &&
    (p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode ?? "").includes(search))
  );

  function stockLeft(p: Product): number | null {
    if (!p.track_stock) return null;
    const inCart = cart.find((l) => l.product.id === p.id)?.qty ?? 0;
    return (stock.get(p.id) ?? 0) - inCart;
  }

  async function checkout(method: "cash" | "offline" | "credit" | "payhero") {
    if (cart.length === 0) return;
    // Client-side guard; the server re-validates everything anyway.
    for (const l of cart) {
      const left = stockLeft(l.product);
      if (left !== null && l.qty > left) {
        setErr(`Not enough stock for “${l.product.name}” (${left} left).`);
        return;
      }
    }
    setBusy(true);
    setErr("");
    setMsg(method === "payhero" ? "Sending STK push…" : "Recording sale…");
    try {
      const res = await fetch("/api/sales/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          client_ref: clientRef,
          items: cart.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_price: Number(l.product.selling_price), discount: l.discount })),
          order_discount: canDiscount ? orderDiscount : 0,
          payment_method: method,
          amount_paid: method === "cash" ? total : 0,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(""); setErr(j.error ?? "Checkout failed"); return; }

      if (method === "payhero") {
        // Second step: initiate the STK push. The channel is resolved
        // SERVER-side from the business' own settings - we deliberately do
        // not send a channel_id, so the client can never pick the channel.
        const stk = await fetch("/api/payments/stk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_id: businessId, purpose: "order", order_id: j.order_id,
            amount: Number(j.total_due), phone: stkPhone,
          }),
        });
        const sj = await stk.json();
        if (!stk.ok) {
          setMsg("");
          setErr(`${sj.error ?? "Could not start payment"} — order ${j.order_no} is saved as awaiting payment.`);
          return;
        }
        setMsg(`M-Pesa prompt sent to ${stkPhone}. Order ${j.order_no} is paid only once PayHero confirms.`);
      } else {
        // Confirmed sale (cash/credit): snapshot the cart for the receipt before it is cleared below.
        setReceipt({
          orderNo: j.order_no,
          method: method === "cash" ? "Cash" : "Credit (unpaid)",
          total: Number(j.totalDue),
          at: new Date().toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }),
          lines: cart.map((l) => ({
            name: l.product.name,
            qty: l.qty,
            unitPrice: Number(l.product.selling_price),
            discount: l.discount,
            lineTotal: l.qty * Number(l.product.selling_price) - l.discount,
          })),
        });
        setMsg(`Sale recorded: ${j.order_no} — KSh ${Number(j.totalDue).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`);
      }
      setCart([]);
      setOrderDiscount(0);
      newSale(); // fresh idempotency key for the next sale
      await refreshStock(businessId);
    } catch {
      setMsg("");
      setErr("Network error — the sale may or may not have been recorded. Check Orders before retrying.");
    } finally {
      setBusy(false);
    }
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
          {categories.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
              <button
                type="button"
                onClick={() => setCategoryId("")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${categoryId === "" ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id === categoryId ? "" : c.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${categoryId === c.id ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => {
              const left = stockLeft(p);
              const out = left !== null && left <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={out}
                  onClick={() => add(p)}
                  className={`rounded-xl border p-3 text-left transition ${out ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50"}`}
                >
                  <p className="truncate text-sm font-semibold text-navy-900">{p.name}</p>
                  <p className="num mt-0.5 text-sm font-medium text-blue-700">KSh {Number(p.selling_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</p>
                  {left !== null && (
                    <p className={`num mt-0.5 text-xs ${out ? "text-red-600" : left <= 5 ? "text-amber-600" : "text-slate-400"}`}>
                      {out ? "Out of stock" : `${left} in stock`}
                    </p>
                  )}
                </button>
              );
            })}
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
                <div key={l.product.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-navy-900">{l.product.name}</p>
                      <p className="num text-xs text-slate-500">
                        KSh {(l.qty * Number(l.product.selling_price) - l.discount).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                        {l.discount > 0 && <span className="text-emerald-600"> (−{formatShort(l.discount)} off)</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" className="btn-outline h-7 w-7 !p-0" aria-label={`Reduce ${l.product.name}`} onClick={() => setQty(l.product.id, -1)}>−</button>
                      <span className="num w-6 text-center font-semibold">{l.qty}</span>
                      <button type="button" className="btn-outline h-7 w-7 !p-0" aria-label={`Increase ${l.product.name}`} onClick={() => setQty(l.product.id, 1)}>+</button>
                      <button type="button" className="btn-outline h-7 w-7 !p-0 text-red-600" aria-label={`Remove ${l.product.name}`} onClick={() => removeLine(l.product.id)}>✕</button>
                    </div>
                  </div>
                  {canDiscount && (
                    <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                      Discount KSh
                      <input
                        type="number" min={0} max={l.qty * Number(l.product.selling_price)} step="0.5"
                        className="input !h-7 !w-24 !py-0 text-xs"
                        aria-label={`Discount for ${l.product.name}`}
                        value={l.discount || ""}
                        onChange={(e) => setLineDiscount(l.product.id, Number(e.target.value) || 0)}
                      />
                    </label>
                  )}
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
            <div className="flex items-center justify-between text-sm text-slate-600">
              <p>Subtotal</p>
              <p className="num">{formatShort(subtotal)}</p>
            </div>
            {(lineDiscounts > 0 || (canDiscount && orderDiscount > 0)) && (
              <div className="flex items-center justify-between text-sm text-emerald-700">
                <p>Discounts</p>
                <p className="num">−{formatShort(lineDiscounts + (canDiscount ? orderDiscount : 0))}</p>
              </div>
            )}
            {canDiscount && (
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                Order discount KSh
                <input
                  type="number" min={0} max={subtotal - lineDiscounts} step="0.5"
                  className="input !h-7 !w-24 !py-0 text-xs"
                  aria-label="Order discount"
                  value={orderDiscount || ""}
                  onChange={(e) => setOrderDiscount(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            )}
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-600">Total</p>
              <p className="num text-2xl font-bold text-navy-900">{formatShort(total)}</p>
            </div>
            <div className="mt-4 grid gap-2">
              <button disabled={cart.length === 0 || busy} onClick={() => checkout("cash")} className="btn-primary py-3">
                💵 Cash sale — receive {formatShort(total)}
              </button>
              {payheroChannel && (
                <div className="grid gap-2">
                  <label htmlFor="stk-phone" className="text-xs font-medium text-slate-500">Customer M-Pesa number</label>
                  <input
                    id="stk-phone"
                    className="input"
                    placeholder="07XXXXXXXX"
                    inputMode="tel"
                    value={stkPhone}
                    onChange={(e) => setStkPhone(e.target.value)}
                  />
                  <button
                    disabled={cart.length === 0 || busy || stkPhone.trim().length < 9}
                    onClick={() => checkout("payhero")}
                    className="btn-outline py-2"
                  >
                    📱 M-Pesa (STK push)
                  </button>
                </div>
              )}
              <button disabled={cart.length === 0 || busy} onClick={() => checkout("credit")} className="btn-outline">
                Record as credit (unpaid)
              </button>
            </div>
            {msg && <p className={`mt-3 text-sm font-medium ${msg.startsWith("Sale recorded") ? "text-emerald-700" : "text-slate-600"}`}>{msg}</p>}
            {err && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{err}</p>}
          </div>
        </div>
      </div>

      {/* Receipt overlay for the last confirmed sale. Printing shows only this
          panel (see the print media query in globals.css). */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Sale receipt">
          <div className="w-full max-w-sm">
            <div id="pos-receipt" className="rounded-2xl bg-white p-6 shadow-xl">
              <div className="text-center">
                <p className="text-lg font-bold text-navy-900">SMARTFLOW POS</p>
                <p className="text-xs text-slate-500">{receipt.at}</p>
              </div>
              <div className="my-3 border-t border-dashed border-slate-300" />
              <p className="text-xs text-slate-600">Order <span className="font-mono font-semibold">{receipt.orderNo}</span> · {receipt.method}</p>
              <ul className="mt-3 space-y-2">
                {receipt.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3 text-sm">
                    <span>{l.qty} × {l.name}{l.discount > 0 && <span className="text-emerald-700"> (−{formatShort(l.discount)})</span>}</span>
                    <span className="num">{formatShort(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <div className="my-3 border-t border-dashed border-slate-300" />
              <div className="flex justify-between text-base font-bold text-navy-900">
                <span>Total</span>
                <span className="num">{formatShort(receipt.total)}</span>
              </div>
              <p className="mt-4 text-center text-xs text-slate-400">Asante — thank you for your business!</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => window.print()} className="btn-primary">🖨️ Print receipt</button>
              <button onClick={() => setReceipt(null)} className="btn-outline">New sale</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatShort(n: number) {
  return `KSh ${n.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
}

