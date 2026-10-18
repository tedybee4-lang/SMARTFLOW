"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { PASSWORD_MIN_LENGTH } from "@/lib/registration";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_HREF } from "@/lib/site";

/** Password reset landing page.
 *  - With a recovery session (arrived via the emailed link → /auth/callback → here):
 *    set a new password.
 *  - Without a session: explain + offer to send a reset link. */
export default function ResetPasswordPage() {
  const [hasSession, setHasSession] = useState<boolean | null>(null); // null = still checking
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestEmail, setRequestEmail] = useState("");
  const [requestMsg, setRequestMsg] = useState("");
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => setHasSession(!!data.session));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (password.length < PASSWORD_MIN_LENGTH) {
      setMsg(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setMsg("Passwords do not match.");
      return;
    }
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setOk(true);
    setMsg("Password updated. Opening your dashboard…");
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 900);
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setRequestMsg("");
    const sb = supabaseBrowser();
    const { error } = await sb.auth.resetPasswordForEmail(requestEmail, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
    });
    setRequestMsg(
      error
        ? error.message
        : "If an account exists for that email, a reset link is on its way. Check your inbox and spam folder."
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:py-24">
      <h1 className="page-title">Reset your password</h1>

      {hasSession === null && <p className="page-sub mt-3">Checking your session…</p>}

      {hasSession === true && (
        <>
          <p className="page-sub mt-3">Choose a new password for your account.</p>
          <form onSubmit={save} className="card mt-6 grid gap-4 p-6">
            <div>
              <label htmlFor="new-password" className="label">New password</label>
              <input id="new-password" type="password" autoComplete="new-password" className="input mt-1.5" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`} required />
            </div>
            <div>
              <label htmlFor="confirm-new" className="label">Confirm new password</label>
              <input id="confirm-new" type="password" autoComplete="new-password" className="input mt-1.5" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <button type="submit" disabled={busy} className="btn-primary py-3">
              {busy ? "Saving…" : "Save new password"}
            </button>
          </form>
          {msg && <p className={`${ok ? "ok-text" : "error-text"} mt-4`}>{msg}</p>}
        </>
      )}

      {hasSession === false && (
        <>
          <p className="page-sub mt-3">
            The reset link from your email opens this page with a session. If you don&apos;t have one yet, request a fresh link
            below.
          </p>
          <form onSubmit={sendReset} className="card mt-6 grid gap-4 p-6">
            <div>
              <label htmlFor="reset-email" className="label">Account email</label>
              <input id="reset-email" type="email" autoComplete="email" className="input mt-1.5" value={requestEmail} onChange={(e) => setRequestEmail(e.target.value)} placeholder="you@example.com" required />
            </div>
            <button type="submit" className="btn-primary py-3">Send reset link</button>
          </form>
          {requestMsg && <p className="hint mt-4">{requestMsg}</p>}
        </>
      )}

      <p className="mt-6 text-sm text-slate-500">
        <Link href="/sign-in" className="font-semibold text-blue-700 hover:underline">Back to sign in</Link>
        {" · "}Need help? Call{" "}
        <a href={SUPPORT_PHONE_HREF} className="font-bold text-blue-700 hover:underline">{SUPPORT_PHONE_DISPLAY}</a>
      </p>
    </div>
  );
}
