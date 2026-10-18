"use client";
import { useEffect, useState } from "react";

/**
 * Platform admin test consoles (client):
 * 1. SMS test — free-form send via central TOPSPEED, never billed to a business.
 * 2. PayHero test — dry-run payload preview, or live STK (≤ KSh 20, confirmed).
 * 3. SMS packages — create/update credit packages businesses can purchase.
 * Secrets never leave the server; only presence booleans are shown.
 */

type SmsStatus = { configured: boolean; hasApiKey: boolean; baseUrl: string };
type PayheroStatus = { configured: boolean; hasPlatformChannel: boolean };
type Pkg = { id: string; name: string; credits: number; price_kes: number; is_active: boolean };

export default function AdminConsoles() {
  const [tab, setTab] = useState<"sms" | "payhero" | "packages">("sms");
  return (
    <section className="card p-5">
      <h2 className="font-bold text-navy-900">Integration test consoles</h2>
      <p className="mt-1 text-sm text-slate-500">
        Central PayHero + TOPSPEED live here. Businesses never hold provider credentials.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {([["sms", "SMS test"], ["payhero", "PayHero test"], ["packages", "SMS packages"]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={tab === k ? "btn-primary" : "btn-outline"}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-5">
        {tab === "sms" && <SmsTest />}
        {tab === "payhero" && <PayheroTest />}
        {tab === "packages" && <SmsPackages />}
      </div>
    </section>
  );
}

function Msg({ err, ok }: { err: string; ok: string }) {
  return (
    <>
      {err && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
      {ok && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{ok}</p>}
    </>
  );
}

function SmsTest() {
  const [st, setSt] = useState<SmsStatus | null>(null);
  const [to, setTo] = useState("2547");
  const [message, setMessage] = useState("Test from SMARTFLOW");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/sms/test").then((r) => r.json()).then((j) => setSt(j.sms ?? null)).catch(() => setSt(null));
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setOk(""); setBusy(true);
    try {
      const res = await fetch("/api/sms/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? "Test send failed");
      else setOk(`Sent to ${j.to} — provider ref ${j.provider_ref ?? "n/a"}. Not billed to any business.`);
    } catch {
      setErr("Network error — try again.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={send} className="grid max-w-xl gap-4">
      <Msg err={err} ok={ok} />
      <p className="text-sm text-slate-500">
        TOPSPEED: {st == null ? "checking…" : st.configured ? `configured (${st.baseUrl})` : "NOT configured — set TOPSPEED_API_KEY server-side"}
      </p>
      <div>
        <label htmlFor="sms-to" className="label">Recipient (2547…)</label>
        <input id="sms-to" className="input mt-1.5" value={to} onChange={(e) => setTo(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="sms-msg" className="label">Message</label>
        <textarea id="sms-msg" className="input mt-1.5" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} required />
      </div>
      <div><button className="btn-primary" disabled={busy}>{busy ? "Sending…" : "Send test SMS"}</button></div>
    </form>
  );
}

function PayheroTest() {
  const [st, setSt] = useState<PayheroStatus | null>(null);
  const [phone, setPhone] = useState("2547");
  const [amount, setAmount] = useState("10");
  const [confirmLive, setConfirmLive] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/payhero-test").then((r) => r.json()).then((j) => setSt(j.payhero ?? null)).catch(() => setSt(null));
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setOk(""); setBusy(true);
    try {
      const res = await fetch("/api/admin/payhero-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, amount: Number(amount), confirm_live: confirmLive }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? "Test failed");
      else if (j.dry_run) setOk(`Dry-run OK — payload: ${JSON.stringify(j.provider_payload)}`);
      else setOk(`Live STK sent (ref ${j.reference}, provider ${j.provider_ref ?? "n/a"}). Approve on your phone.`);
    } catch {
      setErr("Network error — try again.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={run} className="grid max-w-xl gap-4">
      <Msg err={err} ok={ok} />
      <p className="text-sm text-slate-500">
        PayHero: {st == null ? "checking…" : st.configured && st.hasPlatformChannel ? "configured" : "NOT fully configured — set PAYHERO_API_USERNAME + secret + PAYHERO_PLATFORM_CHANNEL_ID server-side"}
      </p>
      <div>
        <label htmlFor="ph-phone" className="label">Your phone (STK prompt arrives here)</label>
        <input id="ph-phone" className="input mt-1.5" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="ph-amount" className="label">Amount (KSh — live sends capped at 20)</label>
        <input id="ph-amount" type="number" min={1} max={confirmLive ? 20 : 100000} className="input mt-1.5" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </div>
      <label className="flex items-center gap-2 text-sm text-navy-900">
        <input type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} />
        Send a REAL STK push (small amount, my own phone)
      </label>
      <div><button className="btn-primary" disabled={busy}>{busy ? "Running…" : confirmLive ? "Send live test STK" : "Dry-run (no charge)"}</button></div>
    </form>
  );
}

function SmsPackages() {
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [form, setForm] = useState({ name: "", credits: "100", price_kes: "200" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/admin/sms-packages").then((r) => r.json()).then((j) => setPkgs(j.packages ?? [])).catch(() => setPkgs([]));
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setOk(""); setBusy(true);
    const res = await fetch("/api/admin/sms-packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, credits: Number(form.credits), price_kes: Number(form.price_kes) }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setErr(j.error ?? "Could not create package");
    else { setOk(`Package “${j.package?.name}” created.`); setForm({ name: "", credits: "100", price_kes: "200" }); load(); }
    setBusy(false);
  }

  async function toggle(p: Pkg) {
    setErr(""); setOk("");
    const res = await fetch("/api/admin/sms-packages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, is_active: !p.is_active }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Could not update package"); }
    load();
  }

  return (
    <div className="grid gap-5">
      <Msg err={err} ok={ok} />
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="pkg-name" className="label">Name</label>
          <input id="pkg-name" className="input mt-1.5 w-48" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </div>
        <div>
          <label htmlFor="pkg-credits" className="label">Credits</label>
          <input id="pkg-credits" type="number" min={1} className="input mt-1.5 w-28" value={form.credits} onChange={(e) => setForm((f) => ({ ...f, credits: e.target.value }))} required />
        </div>
        <div>
          <label htmlFor="pkg-price" className="label">Price (KSh)</label>
          <input id="pkg-price" type="number" min={0} step="0.01" className="input mt-1.5 w-32" value={form.price_kes} onChange={(e) => setForm((f) => ({ ...f, price_kes: e.target.value }))} required />
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Add package"}</button>
      </form>
      <div className="divide-y divide-slate-100">
        {pkgs.map((p) => (
          <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
            <span className="font-medium text-navy-900">{p.name}</span>
            <span className="flex items-center gap-4">
              <span className="num text-slate-600">{p.credits} SMS · KSh {Number(p.price_kes).toFixed(2)}</span>
              <span className={p.is_active ? "badge-ok" : "badge-warn"}>{p.is_active ? "active" : "inactive"}</span>
              <button type="button" className="btn-outline px-3 py-1 text-xs" onClick={() => toggle(p)}>
                {p.is_active ? "Disable" : "Enable"}
              </button>
            </span>
          </div>
        ))}
        {pkgs.length === 0 && <p className="py-3 text-sm text-slate-500">No packages yet — create the first one above.</p>}
      </div>
    </div>
  );
}

