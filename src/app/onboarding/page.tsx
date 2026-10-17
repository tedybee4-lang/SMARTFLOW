"use client";
import { useState } from "react";
import { normalizeKEPhone } from "@/lib/kenya";

const TYPES = ["retail", "boutique", "electronics", "hardware", "wholesale", "restaurant", "salon", "cybercafe", "services", "other"];

export default function OnboardingPage() {
  const [form, setForm] = useState({ name: "", slug: "", business_type: "retail", phone: "", location: "" });
  const [msg, setMsg] = useState("");
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("Saving…");
    if (!normalizeKEPhone(form.phone)) { setMsg("Invalid Kenyan phone number. Use 07XXXXXXXX or +254…"); return; }
    const res = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await res.json();
    setMsg(res.ok ? "Business created. Opening dashboard…" : (j.error ?? "Failed"));
    if (res.ok) window.location.href = "/dashboard";
  }
  return (
    <div className="mx-auto max-w-lg rounded-xl border bg-white p-6">
      <p className="text-sm font-medium text-sky-700">Step 1 of 3 — Business profile</p>
      <h1 className="mt-1 text-xl font-bold">Register your business</h1>
      <form onSubmit={submit} className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">Business name<input required className="rounded border px-3 py-2" value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Storefront slug (unique)<input required pattern="[a-z0-9-]+" className="rounded border px-3 py-2" value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="mama-mboga-kawangware" /></label>
        <label className="grid gap-1 text-sm">Business type<select className="rounded border px-3 py-2" value={form.business_type} onChange={(e) => set("business_type", e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Business phone (M-Pesa number)<input required className="rounded border px-3 py-2" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0712345678" /></label>
        <label className="grid gap-1 text-sm">Location<input className="rounded border px-3 py-2" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Kawangware, Nairobi" /></label>
        <button className="rounded bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500">Create business</button>
      </form>
      {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
