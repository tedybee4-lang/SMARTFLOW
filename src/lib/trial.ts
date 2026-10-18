/**
 * Pure trial/subscription state helpers — no I/O, fully unit-testable.
 * Encodes the billing rules shared by /api/subscriptions/access, the POS
 * sales gate, and the dashboard subscription banner.
 */

/** Every new business gets this many free trial days (from the master plan). */
export const TRIAL_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** Trial ends TRIAL_DAYS after it starts (date-only, UTC). */
export function computeTrialEnd(trialStartedAt: Date): Date {
  return new Date(trialStartedAt.getTime() + TRIAL_DAYS * MS_PER_DAY);
}

/** Raw subscription row (subset used for state evaluation). */
export type SubscriptionRow = {
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  subscription_plans?: { grace_days?: number | null } | null;
} | null;

export type SubscriptionState =
  | "none"        // no row — legacy business created before trial migration
  | "trial"       // inside the free trial window
  | "trial_expired" // trial window elapsed, no paid subscription
  | "active"      // paid, inside the current period
  | "grace"       // period ended, inside the plan's grace days
  | "past_due"    // grace elapsed — selling blocked
  | "suspended"   // manually suspended by platform admin — selling blocked
  | "cancelled";  // cancelled — selling blocked

export type SubscriptionEvaluation = {
  state: SubscriptionState;
  canSell: boolean;
  /** Whole days left in the trial, or null outside a live trial. */
  trialDaysLeft: number | null;
  /** ISO date the trial ends, when known. */
  trialEndsAt: string | null;
};

/** Clamp to whole days, rounding up so "1 second left" still shows 1 day. */
function daysLeft(now: Date, end: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / MS_PER_DAY));
}

/**
 * Evaluate selling access from a subscription row and the current time.
 *
 * Rules:
 * - No row: legacy business — allow selling (migration backfills trial rows).
 * - trial: allowed until trial_ends_at (default TRIAL_DAYS after trial_started_at).
 * - active: allowed while inside the period, then plan grace_days; then past_due.
 * - suspended / cancelled / past_due / trial_expired: selling blocked.
 * - Platform admins can restore access by setting an active subscription.
 */
export function evaluateSubscription(sub: SubscriptionRow, now: Date): SubscriptionEvaluation {
  if (!sub) {
    return { state: "none", canSell: true, trialDaysLeft: null, trialEndsAt: null };
  }

  if (sub.status === "trial") {
    const end = sub.trial_ends_at
      ? new Date(sub.trial_ends_at)
      : sub.trial_started_at
        ? computeTrialEnd(new Date(sub.trial_started_at))
        : null;
    if (!end || now.getTime() < end.getTime()) {
      return {
        state: "trial",
        canSell: true,
        trialDaysLeft: end ? daysLeft(now, end) : TRIAL_DAYS,
        trialEndsAt: end ? end.toISOString() : null,
      };
    }
    return { state: "trial_expired", canSell: false, trialDaysLeft: 0, trialEndsAt: end.toISOString() };
  }

  if (sub.status === "active") {
    if (!sub.current_period_end) {
      return { state: "active", canSell: true, trialDaysLeft: null, trialEndsAt: null };
    }
    const periodEnd = new Date(sub.current_period_end);
    if (now.getTime() <= periodEnd.getTime()) {
      return { state: "active", canSell: true, trialDaysLeft: null, trialEndsAt: null };
    }
    const graceDays = Math.max(0, Number(sub.subscription_plans?.grace_days ?? 0));
    const graceEnd = new Date(periodEnd.getTime() + graceDays * MS_PER_DAY);
    if (graceDays > 0 && now.getTime() <= graceEnd.getTime()) {
      return { state: "grace", canSell: true, trialDaysLeft: null, trialEndsAt: null };
    }
    return { state: "past_due", canSell: false, trialDaysLeft: null, trialEndsAt: null };
  }

  if (sub.status === "suspended") return { state: "suspended", canSell: false, trialDaysLeft: null, trialEndsAt: null };
  if (sub.status === "cancelled") return { state: "cancelled", canSell: false, trialDaysLeft: null, trialEndsAt: null };
  if (sub.status === "trial_expired") return { state: "trial_expired", canSell: false, trialDaysLeft: 0, trialEndsAt: sub.trial_ends_at };
  if (sub.status === "past_due") return { state: "past_due", canSell: false, trialDaysLeft: null, trialEndsAt: null };

  // Unknown status: fail closed to avoid granting selling access on bad data.
  return { state: "suspended", canSell: false, trialDaysLeft: null, trialEndsAt: null };
}

/** User-facing message for a blocked state (empty string when selling is allowed). */
export function blockedMessage(state: SubscriptionState): string {
  switch (state) {
    case "trial_expired":
      return "Your free trial has ended. Choose a plan to keep selling.";
    case "past_due":
      return "Your subscription payment is overdue. Pay your invoice to resume selling.";
    case "suspended":
      return "This subscription is suspended. Contact platform support.";
    case "cancelled":
      return "This subscription is cancelled. Choose a plan to resume selling.";
    default:
      return "";
  }
}
