"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("Signing in…");
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : "Signed in. Opening dashboard…");
    setBusy(false);
    if (!error) window.location.href = "/dashboard";
  }
  return (
    <div className="grid min-h-[calc(100vh-140px)] lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.25),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(124,58,237,0.2),transparent_55%)]" aria-hidden="true" />
        <div className="relative">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-xl font-black">
            S
          </span>
          <h2 className="mt-6 text-3xl font-bold tracking-tight">Welcome back.</h2>
          <p className="mt-3 max-w-sm text-slate-300">
            Sign in to record sales, manage stock, fulfil orders and see how your business is doing today.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {["Real-time sales and balances", "M-Pesa ready checkout", "Your storefront, always open"].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-400" aria-hidden="true">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <h1 className="page-title">Sign in</h1>
          <p className="page-sub">Use your SMARTFLOW account.</p>
          <form onSubmit={signIn} className="mt-6 grid gap-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" type="email" autoComplete="email" className="input mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <input id="password" type="password" autoComplete="current-password" className="input mt-1.5" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button type="submit" disabled={busy} className="btn-primary w-full py-3">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          {msg && <p className={`mt-4 ${msg.includes("Opening") ? "ok-text" : "hint"}`}>{msg}</p>}
          <p className="mt-6 text-sm text-slate-500">
            New here?{" "}
            <Link href="/onboarding" className="font-semibold text-blue-700 hover:underline">
              Create your business
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
