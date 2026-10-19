/**
 * Payment reference ownership validation (server-only).
 *
 * Every PayHero payment attempt points at an entity (order, subscription
 * invoice or SMS purchase) that MUST belong to the same business as the
 * attempt. A client-supplied id is never proof of ownership: it is re-checked
 * here against the tenant column before an attempt row is written, and again
 * in the callback before any money is credited.
 *
 * Cross-tenant ids are reported as "not found" (404) so the API never reveals
 * that a record exists under another tenant.
 */
import { supabaseServiceRole } from "@/lib/supabase-server";

export type ReferenceKind = "order" | "subscription_invoice" | "sms_purchase";

export type OwnedReference =
  | {
      ok: true;
      kind: ReferenceKind;
      id: string;
      businessId: string;
      /** Amount still collectable for this reference (0 when already settled). */
      remaining: number;
      /** Total value of the reference, for audit/amount checks. */
      total: number;
      /** Extra state the caller may need (e.g. invoice/purchase status). */
      status: string | null;
      /** Orders: amount already paid at the time of verification. */
      amountPaid?: number;
      /** SMS purchases: credits the purchase grants. */
      credits?: number;
    }
  | { ok: false; error: string; status: number };

const NOT_FOUND = { ok: false as const, error: "Payment reference not found.", status: 404 };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Order must exist AND belong to `businessId`. Remaining = total_due − amount_paid. */
export async function verifyOrderOwnership(
  businessId: string,
  orderId: string,
): Promise<OwnedReference> {
  const srv = supabaseServiceRole();
  const { data } = await srv
    .from("orders")
    .select("id,business_id,total_due,amount_paid,payment_status")
    .eq("id", orderId)
    .maybeSingle();
  const row = data as {
    id: string; business_id: string; total_due: number; amount_paid: number;
    payment_status: string;
  } | null;
  if (!row || row.business_id !== businessId) return NOT_FOUND;
  const total = round2(Number(row.total_due));
  const paid = round2(Number(row.amount_paid ?? 0));
  return {
    ok: true,
    kind: "order",
    id: row.id,
    businessId: row.business_id,
    remaining: round2(Math.max(0, total - paid)),
    total,
    status: row.payment_status,
    amountPaid: paid,
  };
}

/** Subscription invoice must exist AND belong to `businessId`. */
export async function verifySubscriptionInvoiceOwnership(
  businessId: string,
  invoiceId: string,
): Promise<OwnedReference> {
  const srv = supabaseServiceRole();
  const { data } = await srv
    .from("subscription_invoices")
    .select("id,business_id,amount,status")
    .eq("id", invoiceId)
    .maybeSingle();
  const row = data as {
    id: string; business_id: string; amount: number; status: string;
  } | null;
  if (!row || row.business_id !== businessId) return NOT_FOUND;
  const total = round2(Number(row.amount));
  return {
    ok: true,
    kind: "subscription_invoice",
    id: row.id,
    businessId: row.business_id,
    remaining: row.status === "paid" ? 0 : total,
    total,
    status: row.status,
  };
}

/** SMS purchase must exist AND belong to `businessId`. */
export async function verifySmsPurchaseOwnership(
  businessId: string,
  purchaseId: string,
): Promise<OwnedReference> {
  const srv = supabaseServiceRole();
  const { data } = await srv
    .from("sms_purchases")
    .select("id,business_id,price_kes,credits,status")
    .eq("id", purchaseId)
    .maybeSingle();
  const row = data as {
    id: string; business_id: string; price_kes: number; credits: number; status: string;
  } | null;
  if (!row || row.business_id !== businessId) return NOT_FOUND;
  const total = round2(Number(row.price_kes));
  return {
    ok: true,
    kind: "sms_purchase",
    id: row.id,
    businessId: row.business_id,
    remaining: row.status === "completed" ? 0 : total,
    total,
    status: row.status,
    credits: Number(row.credits ?? 0),
  };
}

/**
 * Verify whichever reference the request named. The kind is derived from the
 * request's PURPOSE, never from a client-supplied label — a request that says
 * purpose="order" but passes an invoice id is rejected.
 */
export async function verifyPaymentReference(args: {
  businessId: string;
  purpose: "order" | "subscription" | "sms";
  orderId?: string | null;
  subscriptionInvoiceId?: string | null;
  smsPurchaseId?: string | null;
}): Promise<OwnedReference> {
  if (args.purpose === "order") {
    if (!args.orderId) {
      return { ok: false, error: "order_id is required for order payments.", status: 400 };
    }
    if (args.subscriptionInvoiceId || args.smsPurchaseId) {
      return {
        ok: false,
        error: "An order payment must reference only an order.",
        status: 400,
      };
    }
    return verifyOrderOwnership(args.businessId, args.orderId);
  }
  if (args.purpose === "subscription") {
    if (!args.subscriptionInvoiceId) {
      return {
        ok: false,
        error: "subscription_invoice_id is required for subscription payments.",
        status: 400,
      };
    }
    if (args.orderId || args.smsPurchaseId) {
      return {
        ok: false,
        error: "A subscription payment must reference only an invoice.",
        status: 400,
      };
    }
    return verifySubscriptionInvoiceOwnership(args.businessId, args.subscriptionInvoiceId);
  }
  if (!args.smsPurchaseId) {
    return { ok: false, error: "sms_purchase_id is required for SMS payments.", status: 400 };
  }
  if (args.orderId || args.subscriptionInvoiceId) {
    return { ok: false, error: "An SMS payment must reference only an SMS purchase.", status: 400 };
  }
  return verifySmsPurchaseOwnership(args.businessId, args.smsPurchaseId);
}

/** The subset of a payment_attempts row the callback needs to re-check ownership. */
export type AttemptForOwnership = {
  business_id: string | null;
  purpose: string;
  order_id?: string | null;
  subscription_invoice_id?: string | null;
  sms_purchase_id?: string | null;
};

/**
 * Re-verify, from the persisted attempt row alone, that the entity being
 * credited belongs to the attempt's own business. This is the callback's
 * second gate: even if a row were written with a mismatched reference, no
 * money is credited and no order/invoice/purchase is touched.
 *
 * Platform attempts (no business, no reference) are not tenant-scoped and
 * therefore have nothing to own — they are reported as "not applicable".
 */
export async function verifyAttemptOwnership(
  attempt: AttemptForOwnership,
): Promise<
  | {
      ok: true;
      kind: ReferenceKind | null;
      id: string | null;
      remaining: number | null;
      total: number | null;
      status: string | null;
      amountPaid?: number;
      credits?: number;
    }
  | { ok: false; error: string; status: number }
> {
  const businessId = attempt.business_id;
  if (!businessId) {
    // Platform test attempt: no tenant, no reference to own.
    if (attempt.order_id || attempt.subscription_invoice_id || attempt.sms_purchase_id) {
      return {
        ok: false,
        error: "Platform payment attempt must not reference a tenant entity.",
        status: 409,
      };
    }
    return { ok: true, kind: null, id: null, remaining: null, total: null, status: null };
  }

  const ref = await verifyPaymentReference({
    businessId,
    purpose: attempt.purpose as "order" | "subscription" | "sms",
    orderId: attempt.order_id,
    subscriptionInvoiceId: attempt.subscription_invoice_id,
    smsPurchaseId: attempt.sms_purchase_id,
  });
  if (!ref.ok) return ref;
  return {
    ok: true,
    kind: ref.kind,
    id: ref.id,
    remaining: ref.remaining,
    total: ref.total,
    status: ref.status,
    amountPaid: ref.amountPaid,
    credits: ref.credits,
  };
}
