"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

export default function ExpensesPage() {
  const [bid, setBid] = useState("");
  const [rows, setRows] = useState<{ id: string; category: string; amount: number; note: string | null }[]>([]);
  const [form, setForm] = useState({ category: "", amount: "", note: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.from("expenses").insert({ business_id: bid, category: form.category, amount: Number(form.amount), note: form.note || null });
    if (error) { setMsg(error.message); setBusy(false); return; }
    setForm({ category: "", amount: "", note: "" });
    await load(bid);
    setMsg("Expense recorded.");
    setBusy(false);
  }
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-sub">{rows.length} recorded · {rows.length > 0 ? `KSh ${total.toLocaleString("en-KE", { minimumFractionDigits: 2 })} in the last ${rows.length}` : "track rent, stock, transport and more"}</p>
        </div>
      </div>

      <form onSubmit={add} className="card p-5">
        <h2 className="font-semibold text-navy-900">Record an expense</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="e-cat" className="sr-only">Category</label>
            <input id="e-cat" required placeholder="Category (rent, stock…)" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div>
            <label htmlFor="e-amt" className="sr-only">Amount</label>
            <input id="e-amt" required placeholder="Amount KSh" inputMode="decimal" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label htmlFor="e-note" className="sr-only">Note</label>
            <input id="e-note" placeholder="Note (optional)" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "＋ Add"}
          </button>
        </div>
        {msg && <p className={`mt-3 ${msg === "Expense recorded." ? "ok-text" : "error-text"}`}>{msg}</p>}
      </form>

      <div className="card divide-y divide-slate-100 overflow-hidden">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50">
            <div>
              <p className="font-medium text-navy-900">{r.category}</p>
              {r.note && <p className="text-sm text-slate-500">{r.note}</p>}
            </div>
            <span className="num font-semibold text-navy-900">KSh {Number(r.amount).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</span>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">No expenses yet — record rent, stock purchases and transport above.</p>
        )}
      </div>
    </div>
  );
}