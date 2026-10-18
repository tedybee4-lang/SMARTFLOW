"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase";

type Member = {
  id: string;
  business_id: string;
  role: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
};

type ApiError = { error: string };

const ROLES: string[] = ["owner", "manager", "cashier", "salesperson", "stockkeeper", "accountant", "delivery", "support"];

async function fetchMembers(bid: string): Promise<{ members?: Member[]; error?: string }> {
  const res = await fetch(`/api/staff?business_id=${encodeURIComponent(bid)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: (data as ApiError).error ?? "Failed to load team." };
  const body = data as { members?: Member[] };
  return { members: body.members ?? [] };
}

export default function StaffPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [msg, setMsg] = useState("");

  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("manager");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = supabaseBrowser();
        const { data: sess } = await sb.auth.getSession();
        if (cancelled) return;
        if (!sess.session) {
          router.replace("/sign-in?next=%2Fstaff");
          return;
        }
        const { data: ms } = await sb.from("memberships").select("business_id").limit(1);
        const bid = (ms?.[0] as unknown as { business_id: string } | undefined)?.business_id;
        if (cancelled) return;
        if (!bid) { setMsg("You are not a member of any business yet."); return; }
        setBusinessId(bid);
        const loaded = await fetchMembers(bid);
        if (cancelled) return;
        if (loaded.error) setMsg(loaded.error);
        else setMembers(loaded.members ?? []);
      } catch {
        if (!cancelled) setMsg("Failed to load team — check your connection.");
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/staff?business_id=" + encodeURIComponent(businessId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg((data as ApiError).error ?? "Failed to assign role.");
      setSaving(false);
      return;
    }
    setUserId(""); setRole("manager");
    const loaded = await fetchMembers(businessId);
    if (loaded.error) setMsg(loaded.error);
    else {
      setMembers(loaded.members ?? []);
      setMsg("Role assigned. The change is reflected in the team list.");
    }
    setSaving(false);
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">My team</h1>
        <p className="page-sub">Manage who can sign in and what they can do. Owner/manager only.</p>
      </div>

      {msg && <p className={`mt-3 ${msg.startsWith("Role assigned") ? "ok-text" : "error-text"}`}>{msg}</p>}

      {!businessId ? (
        <div className="card p-8 text-center text-sm text-slate-500">You are not a member of any business yet. Complete onboarding first.</div>
      ) : (
        <>
          <div className="card p-5">
            <h2 className="font-semibold text-navy-900">Add a member</h2>
            <p className="text-xs text-slate-500">Give someone access to this business. The account must already exist in Supabase Auth — paste their user id below.</p>
            <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="span-full">
                <label htmlFor="m-user" className="sr-only">Supabase Auth user id</label>
                <input id="m-user" required placeholder="auth user id (UUID)" className="input" value={userId} onChange={(ev) => setUserId(ev.target.value)} />
              </div>
              <div className="span-full">
                <label htmlFor="m-role" className="sr-only">Role</label>
                <select id="m-role" className="input" value={role} onChange={(ev) => setRole(ev.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button type="submit" disabled={saving || !userId} className="btn-primary">
                {saving ? "Assigning…" : "Assign"}
              </button>
            </form>
            <p className="mt-2 text-xs text-slate-400">Platform administration is never a membership role — it lives under the platform-admin console.</p>
          </div>

          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>User (member)</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {members.map((mem) => (
                  <tr key={mem.id}>
                    <td className="font-medium text-navy-900">{mem.display_name ?? mem.email ?? mem.user_id}</td>
                    <td className="text-sm">{mem.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {members.length === 0 && <p className="border-t border-slate-100 p-6 text-center text-sm text-slate-500">No members yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}
