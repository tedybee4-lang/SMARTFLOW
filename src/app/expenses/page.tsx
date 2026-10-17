"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

export default function ExpensesPage() {
  const [bid, setBid] = useState("");
  const [rows, setRows] = useState<{ id: string; category: string; amount: number; note: string | null }[]>([]);
  const [form, setForm] = useState({ category: "", amount: "", note: "" });
  const [msg, setMsg] = useState("");
  async function load(id: string) {
    const sb = supabaseBrowser();
    const { data } = await sb.from("expenses").select("id,category,amount,note").eq("business_id", id).order("created_at", { ascending: false }).limit(100);
    setRows((data ?? []) as typeof rows);
  }
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: ms } = await sb.from("memberships").select("business_id").limit(1);
      const id = (ms?.[0] as unknown as { business_id: string } | undefined)?.business_id;
      if (id) { setBid(id); await load(id); }
    })();
  }, []);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const sb = supabaseBrowser();
    const { error } = await sb.from("expenses").insert({ business_id: bid, category: form.category, amount: Number(form.amount), note: form.note || null });
    if (error) { setMsg(error.message); return; }
    setForm({ category: "", amount: "", note: "" });
    await load(bid);
    setMsg("Expense recorded.");
  }
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Expenses</h1>
      <form onSubmit={add} className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-4">
        <input required placeholder="Category (rent, stock…)" className="rounded border px-3 py-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input required placeholder="Amount KSh" inputMode="decimal" className="rounded border px-3 py-2" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <input placeholder="Note" className="rounded border px-3 py-2" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button className="rounded bg-sky-600 px-4 py-2 font-medium text-white">Add</button>
      </form>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
      <div className="rounded-xl border bg-white">
        {rows.map((r) => <div key={r.id} className="flex justify-between border-b p-3 text-sm"><span>{r.category}{r.note ? ` — ${r.note}` : ""}</span><span className="font-medium">KSh {Number(r.amount).toFixed(2)}</span></div>)}
        {rows.length === 0 && <p className="p-4 text-sm text-slate-500">No expenses yet.</p>}
      </div>
    </div>
  );
}
