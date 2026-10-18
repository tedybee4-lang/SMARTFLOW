"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

type Storefront = {
  is_published: boolean;
  hero_text: string | null;
  delivery_fee: number;
  whatsapp_number: string | null;
};

export default function StorefrontSettingsPage() {
  const [businessId, setBusinessId] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [form, setForm] = useState({
    is_published: false,
    hero_text: "",
    delivery_fee: 0,
    whatsapp_number: "",
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
      const res = await fetch(`/api/storefront?business_id=${bid}`);
      if (res.ok) {
        const j: { storefront: Storefront | null; slug: string | null } = await res.json();
        if (j.slug) { setSlug(j.slug); setSlugDraft(j.slug); }
        if (j.storefront) {
          setForm({
            is_published: j.storefront.is_published,
            hero_text: j.storefront.hero_text ?? "",
            delivery_fee: Number(j.storefront.delivery_fee ?? 0),
            whatsapp_number: j.storefront.whatsapp_number ?? "",
          });
        }
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
      const body: Record<string, unknown> = { business_id: businessId, ...form };
      const nextSlug = slugDraft.trim().toLowerCase();
      if (nextSlug && nextSlug !== slug) body.slug = nextSlug;
      const res = await fetch("/api/storefront", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not save storefront");
      } else {
        if (j.slug) { setSlug(j.slug); setSlugDraft(j.slug); }
        setMsg("Storefront saved.");
      }
    } catch {
      setErr("Network error — check your connection and try again.");
    }
    setBusy(false);
  }

  if (!loaded && !err) return <p className="page-sub">Loading storefront…</p>;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = slug ? `${origin}/s/${slug}` : "";

  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <h1 className="page-title">Storefront settings</h1>
        <p className="page-sub">Your public shop link, hero message and publication status.</p>
      </div>

      {err && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
      {msg && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}

      {/* Public link card */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-navy-900">Your shop link</h2>
        <p className="mt-1 text-sm text-slate-500">Customers visit this URL to see your products and order online.</p>
        {publicUrl ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a href={publicUrl} target="_blank" rel="noreferrer" className="num rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-blue-700 hover:underline">
              {publicUrl}
            </a>
            <Link href={`/s/${slug}`} className="btn-outline text-sm">Preview →</Link>
          </div>
        ) : (
          <p className="mt-3 text-sm text-amber-600">Slug not loaded yet.</p>
        )}
        <div className="mt-4">
          <label htmlFor="slug" className="label">Shop address (unique URL)</label>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-sm text-slate-500">/s/</span>
            <input
              id="slug"
              className="input flex-1"
              value={slugDraft}
              onChange={(e) => setSlugDraft(e.target.value.toLowerCase())}
              maxLength={50}
              pattern="[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?"
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">Lowercase letters, numbers and dashes. Changing it breaks old links.</p>
        </div>
      </div>

      <form onSubmit={save} className="card grid gap-5 p-6">
        <div>
          <h2 className="text-base font-semibold text-navy-900">Shop content</h2>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.is_published}
            onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))}
          />
          Publish my storefront (visible to everyone with the link)
        </label>

        <div>
          <label htmlFor="hero_text" className="label">Hero message</label>
          <input
            id="hero_text"
            className="input mt-1.5"
            value={form.hero_text}
            onChange={(e) => setForm((f) => ({ ...f, hero_text: e.target.value }))}
            maxLength={500}
            placeholder="Karibu — order online."
          />
        </div>

        <div>
          <label htmlFor="delivery_fee" className="label">Delivery fee (KSh)</label>
          <input
            id="delivery_fee"
            className="input mt-1.5"
            type="number"
            min={0}
            step="0.01"
            value={form.delivery_fee}
            onChange={(e) => setForm((f) => ({ ...f, delivery_fee: Number(e.target.value) }))}
          />
        </div>

        <div>
          <label htmlFor="whatsapp_number" className="label">WhatsApp number (optional)</label>
          <input
            id="whatsapp_number"
            className="input mt-1.5"
            value={form.whatsapp_number}
            onChange={(e) => setForm((f) => ({ ...f, whatsapp_number: e.target.value }))}
            maxLength={20}
            placeholder="07XXXXXXXX"
          />
        </div>

        <div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save storefront"}
          </button>
        </div>
      </form>
    </div>
  );
}
