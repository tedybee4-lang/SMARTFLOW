"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { sanitizeRedirect } from "@/lib/access";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_HREF } from "@/lib/site";

/** Completes Supabase Auth email links (email verification & password recovery).
 *  The verification email links here with ?next=… so that after the exchange the
 *  user lands exactly where they were headed (e.g. /onboarding after /register). */
export default function AuthCallbackPage() {
  const [err, setErr] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; guard the exchange
    started.current = true;

    async function finish() {
      const url = window.location.href;
      const params = new URLSearchParams(window.location.search);
      const next = sanitizeRedirect(params.get("next"), "/onboarding");
      const code = params.get("code");
      const sb = supabaseBrowser();

      if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(url);
        if (error) {
          setErr(
            "We could not complete verification — the link may have expired or already been used. " +
              "Sign in and request a fresh link if needed."
          );
          return;
        }
      }

      const { data } = await sb.auth.getSession();
      if (data.session) {
        window.location.href = next;
      } else if (!err) {
        setErr("We could not complete verification. Sign in and request a fresh link, or call support.");
      }
    }
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center sm:py-28">
      {!err ? (
        <>
          <span className="mx-auto flex h-14 w-14 animate-pulse items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-xl text-white shadow-lg" aria-hidden="true">
            ✓
          </span>
          <h1 className="page-title mt-6">Completing verification…</h1>
          <p className="page-sub mt-3">Hang tight — this only takes a moment.</p>
        </>
      ) : (
        <>
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-xl text-white shadow-lg" aria-hidden="true">
            !
          </span>
          <h1 className="page-title mt-6">Verification failed</h1>
          <p className="page-sub mt-3">{err}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/sign-in" className="btn-primary px-6 py-3">
              Go to sign in
            </Link>
            <Link href="/register" className="btn-outline px-6 py-3">
              Register again
            </Link>
          </div>
          <p className="mt-6 text-sm text-slate-500">
            Need help? Call{" "}
            <a href={SUPPORT_PHONE_HREF} className="font-bold text-blue-700 hover:underline">{SUPPORT_PHONE_DISPLAY}</a>
          </p>
        </>
      )}
    </div>
  );
}
