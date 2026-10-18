"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { normalizeKEPhone } from "@/lib/kenya";
import { supabaseBrowser } from "@/lib/supabase";

const TYPES = ["retail", "boutique", "electronics", "hardware", "wholesale", "restaurant", "salon", "cybercafe", "services", "other"];
const STEPS = ["Business profile", "Contact & location", "Review & create"];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", slug: "", business_type: "retail", phone: "", location: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const gated = useRef(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Business setup requires an authenticated account (register first).
  useEffect(() => {
    if (gated.current) return;
    gated.current = true;
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (!data.session) window.location.href = "/sign-in?next=/onboarding";
      });
  }, []);


  function next(e: React.FormEvent) {
    e.preventDefault();
    setStep((s) => Math.min(2, s + 1));
  }
  async function submit() {
    setBusy(true);
    setMsg("Saving…");
    if (!normalizeKEPhone(form.phone)) { setMsg("Invalid Kenyan phone number. Use 07XXXXXXXX or +254…"); setBusy(false); return; }
    try {
      const res = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(j.existing ? "Business already set up. Opening dashboard…" : "Business created. Opening dashboard…");
        setTimeout(() => { window.location.href = "/dashboard"; }, 400);
        return;
      }
      setMsg(j.error ?? "Failed");
    } catch {
      setMsg("Network error — check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-16">
      <p className="text-sm font-semibold uppercase tracking-widest text-blue-700">Get started — it&apos;s free</p>
      <h1 className="page-title mt-1">Register your business</h1>
      <p className="page-sub">Three short steps. You can update everything later.</p>

      {/* Progress */}
      <ol className="mt-8 flex items-center gap-2" aria-label="Onboarding progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-2">
            <span
              className={`h-1.5 rounded-full transition-colors ${i <= step ? "bg-blue-600" : "bg-slate-200"}`}
              aria-hidden="true"
            />
            <span className={`text-xs font-medium ${i === step ? "text-navy-900" : i < step ? "text-blue-700" : "text-slate-400"}`}>
              {i + 1}. {label}
            </span>
          </li>
        ))}
      </ol>
      <div className="card mt-6 p-6">
        {step === 0 && (
          <form onSubmit={next} className="grid gap-4">
            <div>
              <label htmlFor="name" className="label">Business name</label>
              <input id="name" required className="input mt-1.5" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Mama Mboga Kawangware" />
            </div>
            <div>
              <label htmlFor="slug" className="label">Storefront slug (unique)</label>
              <input id="slug" required pattern="[a-z0-9-]+" className="input mt-1.5" value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="mama-mboga-kawangware" />
              <p className="mt-1 text-xs text-slate-500">Your shop link will be <code className="rounded bg-slate-100 px-1 py-0.5">/s/{form.slug || "your-slug"}</code></p>
            </div>
            <div>
              <label htmlFor="type" className="label">Business type</label>
              <select id="type" className="input mt-1.5" value={form.business_type} onChange={(e) => set("business_type", e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button type="submit" className="btn-primary mt-2">Continue</button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={next} className="grid gap-4">
            <div>
              <label htmlFor="phone" className="label">Business phone (M-Pesa number)</label>
              <input id="phone" required className="input mt-1.5" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0712345678" />
              <p className="mt-1 text-xs text-slate-500">Used for M-Pesa payments and customer callbacks.</p>
            </div>
            <div>
              <label htmlFor="location" className="label">Location</label>
              <input id="location" className="input mt-1.5" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Kawangware, Nairobi" />
            </div>
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} className="btn-outline">Back</button>
              <button type="submit" className="btn-primary flex-1">Continue</button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {([
                ["Business name", form.name],
                ["Storefront", `/s/${form.slug}`],
                ["Type", form.business_type],
                ["Phone", form.phone],
                ["Location", form.location || "—"],
              ] as Array<[string, string]>).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-4 py-3 text-sm">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-medium text-navy-900">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} className="btn-outline">Back</button>
              <button type="button" disabled={busy} onClick={submit} className="btn-primary flex-1 py-3">
                {busy ? "Creating…" : "Create business"}
              </button>
            </div>
          </div>
        )}

        {msg && <p className={`mt-4 ${msg.includes("Opening") ? "ok-text" : "error-text"}`}>{msg}</p>}
      </div>
      <p className="mt-6 text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold text-blue-700 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}