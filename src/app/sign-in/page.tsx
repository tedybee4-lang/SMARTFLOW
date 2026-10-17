"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setMsg("Signing in…");
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : "Signed in. Opening dashboard…");
    if (!error) window.location.href = "/dashboard";
  }
  return (
    <div className="mx-auto max-w-md rounded-xl border bg-white p-6">
      <h1 className="text-xl font-bold">Sign in</h1>
      <form onSubmit={signIn} className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">Email<input className="rounded border px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="grid gap-1 text-sm">Password<input type="password" className="rounded border px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="rounded bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500">Sign in</button>
      </form>
      {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
