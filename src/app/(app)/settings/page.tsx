"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import type { PaymentChannelInput } from "@/lib/validation";

type Settings = {
  payment_method: "till" | "paybill" | "payhero" | null;
  till_number: string;
  paybill_number: string;
  channel_id: string;
  is_active: boolean;
  configured: boolean;
};

export default function SettingsPage() {
  const [businessId, setBusinessId] = useState("");
  const [form, setForm] = useState({
    payment_method: "till" as PaymentChannelInput["payment_method"],
    till_number: "",
    paybill_number: "",
    channel_id: "",
    is_active: true,
  });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: ms } = await sb.from("memberships").select("business_id").limit(1);
      const bid = (ms?.[0] as unknown as { business_id: string } | undefined)?.business_id;
      if (!bid) { setErr("No business found — complete onboarding first."); return; }
      setBusinessId(bid);
      const res = await fetch(`/api/business/payment-channel?business_id=${bid}`);
      if (res.ok) {
        const j: Settings = await res.json();
        setForm({
          payment_method: j.payment_method ?? "till",
          till_number: j.till_number,
          paybill_number: j.paybill_number,
          channel_id: j.channel_id,
          is_active: j.is_active,
        });
      }
      setLoaded(true);
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/business/payment-channel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, ...form }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not save settings");
      } else {
        setMsg("Payment settings saved. Customers will pay to the number you chose.");
      }
    } catch {
      setErr("Network error — check your connection and try again.");
    }
    setBusy(false);
  }

  if (!loaded && !err) return <p className="page-sub">Loading settings…</p>;

  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Configure how customers pay your business.</p>
      </div>

      {err && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
      {msg && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}

      <form onSubmit={save} className="card grid gap-5 p-6">
        <div>
          <h2 className="text-base font-semibold text-navy-900">Customer payments</h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose the M-Pesa Till or PayBill number your customers pay to, or connect PayHero for STK push.
          </p>
        </div>

        <fieldset className="grid gap-2">
          <legend className="label mb-1">Payment method</legend>
          {([
            ["till", "M-Pesa Till"],
            ["paybill", "M-Pesa PayBill"],
            ["payhero", "PayHero channel (STK push)"],
          ] as const).map(([value, labelText]) => (
            <label key={value} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
              <input
                type="radio"
                name="payment_method"
                value={value}
                checked={form.payment_method === value}
                onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value as PaymentChannelInput["payment_method"] }))}
              />
              {labelText}
            </label>
          ))}
        </fieldset>

        {form.payment_method === "till" && (
          <div>
            <label htmlFor="till_number" className="label">Till number</label>
            <input
              id="till_number"
              className="input mt-1.5"
              value={form.till_number}
              onChange={(e) => setForm((f) => ({ ...f, till_number: e.target.value }))}
              inputMode="numeric"
              placeholder="e.g. 8765432"
              required
            />
          </div>
        )}
        {form.payment_method === "paybill" && (
          <div>
            <label htmlFor="paybill_number" className="label">PayBill number</label>
            <input
              id="paybill_number"
              className="input mt-1.5"
              value={form.paybill_number}
              onChange={(e) => setForm((f) => ({ ...f, paybill_number: e.target.value }))}
              inputMode="numeric"
              placeholder="e.g. 400200"
              required
            />
          </div>
        )}
        {form.payment_method === "payhero" && (
          <div>
            <label htmlFor="channel_id" className="label">PayHero channel ID</label>
            <input
              id="channel_id"
              className="input mt-1.5"
              value={form.channel_id}
              onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))}
              placeholder="Channel ID from your PayHero dashboard"
              required
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
          />
          Accept payments on this method
        </label>

        <div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
