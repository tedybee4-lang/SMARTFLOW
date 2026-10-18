import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";

const Schema = z.object({
  business_id: z.string().uuid(),
  branch_id: z.string().uuid().optional(),
  category: z.string().min(1).max(80),
  amount: z.number().positive(),
  note: z.string().max(500).optional().default(""),
  spent_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Expenses: create / list. */
export async function POST(req: Request) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid expense" }, { status: 400 });
  const input = parsed.data;
  const m = await requireMembership(input.business_id, ["owner", "manager", "accountant"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("expenses").insert({
    business_id: input.business_id, branch_id: input.branch_id ?? null,
    category: input.category, amount: input.amount, note: input.note || null,
    spent_at: input.spent_at ?? new Date().toISOString().slice(0, 10),
    created_by: m.user.id,
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: "Could not record expense" }, { status: 500 });
  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "expense.create", entity: "expenses", entity_id: (data as { id: string }).id,
    after_data: { category: input.category, amount: input.amount },
  });
  return NextResponse.json({ expense_id: (data as { id: string }).id }, { status: 201 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("expenses").select("id,category,amount,note,spent_at,created_at").eq("business_id", businessId).order("spent_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: "Could not load expenses" }, { status: 500 });
  return NextResponse.json({ expenses: data ?? [] });
}