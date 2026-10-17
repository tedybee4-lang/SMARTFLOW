"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

type Product = { id: string; name: string; selling_price: number; cost_price: number; barcode: string };

export default function ProductsPage() {
  const [businessId, setBusinessId] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [form, setForm] = useState({ name: "", selling_price: "", cost_price: "", barcode: "" });
  const [msg, setMsg] = useState("");

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
    setMsg("Saving…");
    const sb = supabaseBrowser();
    const { error } = await sb.from("products").insert({
      business_id: businessId, name: form.name,
      selling_price: Number(form.selling_price) || 0, cost_price: Number(form.cost_price) || 0,
      barcode: form.barcode || null,
    });
    if (error) { setMsg(error.message); return; }
    setForm({ name: "", selling_price: "", cost_price: "", barcode: "" });
    await load(businessId);
    setMsg("Product added.");
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Products</h1>
      <form onSubmit={add} className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-5">
        <input required placeholder="Name" className="rounded border px-3 py-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Selling KSh" inputMode="decimal" className="rounded border px-3 py-2" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} />
        <input placeholder="Cost KSh" inputMode="decimal" className="rounded border px-3 py-2" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} />
        <input placeholder="Barcode" className="rounded border px-3 py-2" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
        <button className="rounded bg-sky-600 px-4 py-2 font-medium text-white">Add</button>
      </form>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500"><th className="p-3">Name</th><th className="p-3">Selling</th><th className="p-3">Cost</th><th className="p-3">Barcode</th></tr></thead>
          <tbody>{items.map((p) => (
            <tr key={p.id} className="border-b"><td className="p-3 font-medium">{p.name}</td><td className="p-3">KSh {Number(p.selling_price).toFixed(2)}</td><td className="p-3">KSh {Number(p.cost_price).toFixed(2)}</td><td className="p-3">{p.barcode ?? "—"}</td></tr>
          ))}</tbody>
        </table>
        {items.length === 0 && <p className="p-4 text-sm text-slate-500">No products yet — add your first product above.</p>}
      </div>
    </div>
  );
}
