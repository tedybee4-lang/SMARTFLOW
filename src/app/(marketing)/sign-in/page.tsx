"use client";
import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { sanitizeRedirect } from "@/lib/access";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_HREF } from "@/lib/site";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [forgotMsg, setForgotMsg] = useState("");

  function nextTarget(): string | null {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    return next ? sanitizeRedirect(next) : null;
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("Signing in…");
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      if (code === "email_not_confirmed" || /email not confirmed/i.test(error.message)) {
        setMsg("Your email isn't verified yet. Check your inbox for the verification link — or resend it below.");
      } else if (/invalid login credentials/i.test(error.message)) {
        setMsg("Wrong email or password. Try again, or reset your password.");
      } else {
        setMsg(error.message);
      }
      setBusy(false);
      return;
    }
    // Signed in. Route: explicit ?next= wins, otherwise dashboard (which guides
    // business setup itself if the account has no business yet).
    const target = nextTarget() ?? "/dashboard";
    window.location.href = target;
  }

  async function resendVerification() {
    setMsg("");
    const sb = supabaseBrowser();
    const { error } = await sb.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextTarget() ?? "/dashboard")}` },
    });
    setMsg(error ? error.message : "Verification email sent — open the link in it, then sign in.");
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setForgotMsg("Sending…");
    const sb = supabaseBrowser();
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
    });
    setForgotMsg(
      error
        ? error.message
        : "If an account exists for that email, a reset link is on its way. Open it to set a new password."
    );
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
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          {mode === "signin" ? (
            <>
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
              {msg && (
                <p className={`mt-4 ${msg.includes("verification link") || msg.includes("Verification email") ? "hint" : "error-text"}`}>
                  {msg}{" "}
                  {msg.includes("isn't verified") && (
                    <button type="button" onClick={resendVerification} className="font-bold underline">
                      Resend verification email
                    </button>
                  )}
                </p>
              )}
              <button type="button" onClick={() => { setMode("forgot"); setMsg(""); }} className="mt-4 text-sm font-semibold text-blue-700 hover:underline">
                Forgot password?
              </button>
              <p className="mt-6 text-sm text-slate-500">
                New here?{" "}
                <Link href="/register" className="font-semibold text-blue-700 hover:underline">
                  Create your account
                </Link>
              </p>
            </>
          ) : (
            <>
              <h1 className="page-title">Forgot password</h1>
              <p className="page-sub">Enter your account email and we&apos;ll send a reset link.</p>
              <form onSubmit={sendReset} className="mt-6 grid gap-4">
                <div>
                  <label htmlFor="reset-email" className="label">Email</label>
                  <input id="reset-email" type="email" autoComplete="email" className="input mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <button type="submit" className="btn-primary w-full py-3">Send reset link</button>
              </form>
              {forgotMsg && <p className="hint mt-4">{forgotMsg}</p>}
              <button type="button" onClick={() => { setMode("signin"); setForgotMsg(""); }} className="mt-4 text-sm font-semibold text-blue-700 hover:underline">
                ← Back to sign in
              </button>
            </>
          )}
          <p className="mt-6 text-sm text-slate-500">
            Need help? Call{" "}
            <a href={SUPPORT_PHONE_HREF} className="font-bold text-blue-700 hover:underline">{SUPPORT_PHONE_DISPLAY}</a>
          </p>
        </div>
      </div>
    </div>
  );
}
