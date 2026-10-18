"use client";
import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { RegisterSchema, PASSWORD_MIN_LENGTH } from "@/lib/registration";
import { sanitizeRedirect } from "@/lib/access";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_HREF } from "@/lib/site";

type FieldErrors = Partial<Record<"fullName" | "email" | "password" | "confirmPassword", string>>;

export default function RegisterPage() {
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(""); // set after signup when email verification is required
  const [resendMsg, setResendMsg] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  function validate(): FieldErrors {
    const parsed = RegisterSchema.safeParse(form);
    if (parsed.success) return {};
    const fe: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FieldErrors | undefined;
      if (key && !fe[key]) fe[key] = issue.message;
    }
    return fe;
  }

  function nextTarget(): string {
    const params = new URLSearchParams(window.location.search);
    return sanitizeRedirect(params.get("next"), "/onboarding");
  }

  async function continueAfterVerify() {
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getSession();
    if (data.session) {
      window.location.href = nextTarget();
    } else {
      setResendMsg("Still not verified — open the latest link we emailed you. Need a new one? Use the button above.");
    }
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setResendMsg("");
    const fe = validate();
    setErrors(fe);
    if (Object.values(fe).some(Boolean)) return;

    setBusy(true);
    const sb = supabaseBrowser();
    try {
      const origin = window.location.origin;
      const { data, error } = await sb.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { full_name: form.fullName }, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextTarget())}` },
      });
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        if (code === "user_already_exists" || /already (registered|exists)/i.test(error.message)) {
          setFormError("An account with this email already exists. Sign in instead — or use password reset if you've forgotten it.");
        } else if (code === "over_email_send_rate_limit" || /rate limit/i.test(error.message)) {
          setFormError("Too many attempts. Please wait a minute and try again.");
        } else if (code === "weak_password" || /password should be/i.test(error.message)) {
          setErrors({ password: "Choose a stronger password (at least " + PASSWORD_MIN_LENGTH + " characters)." });
        } else {
          setFormError(error.message || "Could not create the account. Please try again.");
        }
        setBusy(false);
        return;
      }
      // Supabase may return a session instantly if email confirmation is disabled.
      if (data.session) {
        window.location.href = nextTarget();
        return;
      }
      // Otherwise the account exists but needs email verification.
      setPendingEmail(form.email);
    } catch {
      setFormError("Network error — check your connection and try again.");
    }
    setBusy(false);
  }

  async function resendVerification() {
    setResendMsg("");
    const sb = supabaseBrowser();
    try {
      const { error } = await sb.auth.resend({
        type: "signup",
        email: form.email || pendingEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextTarget())}` },
      });
      setResendMsg(error ? error.message : "Verification email sent again — check your inbox (and spam folder).");
    } catch {
      setResendMsg("Could not send — network error. Try again shortly.");

  // ============ Email-verification pending state ============
    }
  }
  if (pendingEmail) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:py-24">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-2xl text-white shadow-lg" aria-hidden="true">
          ✉
        </span>
        <h1 className="page-title mt-6">Verify your email</h1>
        <p className="page-sub mt-3">
          We sent a verification link to <strong className="text-navy-900">{pendingEmail}</strong>. Open it to activate your
          account — then you&apos;ll be able to set up your business.
        </p>
        <div className="card mt-8 p-6">
          <ul className="space-y-2 text-sm text-slate-600">
            <li>• The link expires — request a fresh one if it stopped working.</li>
            <li>• Didn&apos;t see it? Check your spam or junk folder.</li>
            <li>• Typed the wrong address? Register again with the correct email.</li>
          </ul>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={resendVerification} className="btn-outline flex-1">
              Resend email
            </button>
            <button type="button" onClick={continueAfterVerify} className="btn-primary flex-1 py-3">
              I&apos;ve verified — continue
            </button>
          </div>
          {resendMsg && <p className="hint mt-4">{resendMsg}</p>}
        </div>
        <p className="mt-6 text-sm text-slate-500">
          Stuck? Call <a href={SUPPORT_PHONE_HREF} className="font-bold text-blue-700 hover:underline">{SUPPORT_PHONE_DISPLAY}</a>.
        </p>
      </div>
    );
  }

  // ============ Registration form ============
  return (
    <div className="grid min-h-[calc(100vh-140px)] lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(249,115,22,0.22),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(37,99,235,0.28),transparent_55%)]" aria-hidden="true" />
        <div className="relative">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-xl font-black">
            S
          </span>
          <h2 className="mt-6 text-3xl font-bold tracking-tight">One account. Every part of your business.</h2>
          <p className="mt-3 max-w-sm text-slate-300">
            Create your SMARTFLOW account first. Right after that you&apos;ll set up your shop — products, staff, storefront and all.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {["Sell at the counter and online", "Track stock, expenses and profit", "Prices in KSh, M-Pesa ready"].map((t) => (
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
          <h1 className="page-title">Create your account</h1>
          <p className="page-sub">Step 1 of 2 — your login. Next you&apos;ll set up your business.</p>
          <form onSubmit={register} className="mt-6 grid gap-4" noValidate>
            <div>
              <label htmlFor="fullName" className="label">Full name</label>
              <input id="fullName" autoComplete="name" className="input mt-1.5" value={form.fullName} onChange={set("fullName")} placeholder="Jane Wanjiku" required />
              {errors.fullName && <p className="error-text mt-1">{errors.fullName}</p>}
            </div>
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" type="email" autoComplete="email" className="input mt-1.5" value={form.email} onChange={set("email")} placeholder="you@example.com" required />
              <p className="hint mt-1">You&apos;ll verify this email — it&apos;s how you sign in.</p>
              {errors.email && <p className="error-text mt-1">{errors.email}</p>}
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <input id="password" type="password" autoComplete="new-password" className="input mt-1.5" value={form.password} onChange={set("password")} placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`} required />
              {errors.password && <p className="error-text mt-1">{errors.password}</p>}
            </div>
            <div>
              <label htmlFor="confirmPassword" className="label">Confirm password</label>
              <input id="confirmPassword" type="password" autoComplete="new-password" className="input mt-1.5" value={form.confirmPassword} onChange={set("confirmPassword")} required />
              {errors.confirmPassword && <p className="error-text mt-1">{errors.confirmPassword}</p>}
            </div>
            <button type="submit" disabled={busy} className="btn-primary mt-2 py-3">
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
          {formError && (
            <p className="error-text mt-4">
              {formError}{" "}
              {formError.includes("already exists") && (
                <Link href="/sign-in" className="font-bold underline">Sign in</Link>
              )}
            </p>
          )}
          <p className="mt-6 text-sm text-slate-500">
            Already have an account?{" "}
            <Link href="/sign-in" className="font-semibold text-blue-700 hover:underline">Sign in</Link>
          </p>
          <p className="mt-4 text-sm text-slate-500">
            Need help? Call{" "}
            <a href={SUPPORT_PHONE_HREF} className="font-bold text-blue-700 hover:underline">{SUPPORT_PHONE_DISPLAY}</a>
          </p>
        </div>
      </div>
    </div>
  );
}
