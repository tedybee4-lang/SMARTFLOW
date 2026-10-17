"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

type Product = { id: string; name: string; selling_price: number; cost_price: number; barcode: string };

export default function ProductsPage() {
  const [businessId, setBusinessId] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [form, setForm] = useState({ name: "", selling_price: "", cost_price: "", barcode: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(bid: string) {
    const sb = supabaseBrowser();
    const { data } = await sb.from("products").select("id,name,selling_price,cost_price,barcode").eq("business_id", bid).order("name").limit(200);
    setItems((data ?? []) as Product[]);
  }
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: ms } = await sb.from("memberships").select("business_id").limit(1);
      const bid = (ms?.[0] as unknown as { business_id: string } | undefined)?.business_id;
      if (!bid) { setMsg("No business found."); return; }
      setBusinessId(bid);
      await load(bid);
    })();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("Saving…");
    const sb = supabaseBrowser();
    const { error } = await sb.from("products").insert({
      business_id: businessId, name: form.name,
      selling_price: Number(form.selling_price) || 0, cost_price: Number(form.cost_price) || 0,
      barcode: form.barcode || null,
    });
    if (error) { setMsg(error.message); setBusy(false); return; }
    setForm({ name: "", selling_price: "", cost_price: "", barcode: "" });
    await load(businessId);
    setMsg("Product added.");
    setBusy(false);
  }
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">Products</h1>
        <p className="page-sub">{items.length} product{items.length === 1 ? "" : "s"} · Stock moves automatically with every sale.</p>
      </div>

      <form onSubmit={add} className="card p-5">
        <h2 className="font-semibold text-navy-900">Add a product</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <label htmlFor="p-name" className="sr-only">Name</label>
            <input id="p-name" required placeholder="Name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="p-sell" className="sr-only">Selling price</label>
            <input id="p-sell" placeholder="Selling KSh" inputMode="decimal" className="input" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} />
          </div>
          <div>
            <label htmlFor="p-cost" className="sr-only">Cost price</label>
            <input id="p-cost" placeholder="Cost KSh" inputMode="decimal" className="input" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} />
          </div>
          <div>
            <label htmlFor="p-barcode" className="sr-only">Barcode</label>
            <input id="p-barcode" placeholder="Barcode" className="input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          </div>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "＋ Add"}
          </button>
        </div>
        {msg && <p className={`mt-3 ${msg === "Product added." ? "ok-text" : "error-text"}`}>{msg}</p>}
      </form>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th className="text-right">Selling</th>
              <th className="text-right">Cost</th>
              <th>Barcode</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td className="font-medium text-navy-900">{p.name}</td>
                <td className="num text-right font-semibold text-blue-700">KSh {Number(p.selling_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</td>
                <td className="num text-right text-slate-600">KSh {Number(p.cost_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</td>
                <td className="text-slate-500">{p.barcode ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <p className="border-t border-slate-100 p-6 text-center text-sm text-slate-500">
            No products yet — add your first product above.
          </p>
        )}
      </div>
    </div>
  );
}