import { describe, expect, it } from "vitest";
import {
  TRIAL_DAYS,
  computeTrialEnd,
  evaluateSubscription,
  blockedMessage,
  type SubscriptionRow,
} from "../trial";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function trialRow(overrides: Partial<NonNullable<SubscriptionRow>> = {}): NonNullable<SubscriptionRow> {
  return {
    status: "trial",
    trial_started_at: iso(daysAgo(1)),
    trial_ends_at: iso(daysAhead(TRIAL_DAYS - 1)),
    current_period_start: null,
    current_period_end: null,
    ...overrides,
  };
}

describe("computeTrialEnd", () => {
  it("adds exactly 7 days", () => {
    expect(iso(computeTrialEnd(NOW))).toBe("2026-10-25T12:00:00.000Z");
    expect(TRIAL_DAYS).toBe(7);
  });
});

describe("evaluateSubscription", () => {
  it("legacy business with no subscription row can sell", () => {
    const r = evaluateSubscription(null, NOW);
    expect(r).toEqual({ state: "none", canSell: true, trialDaysLeft: null, trialEndsAt: null });
  });

  it("fresh trial can sell with days left", () => {
    const r = evaluateSubscription(trialRow(), NOW);
    expect(r.state).toBe("trial");
    expect(r.canSell).toBe(true);
    expect(r.trialDaysLeft).toBe(6);
  });

  it("trial with seconds left still shows 1 day and can sell", () => {
    const r = evaluateSubscription(
      trialRow({ trial_ends_at: iso(new Date(NOW.getTime() + 1000)) }),
      NOW,
    );
    expect(r.state).toBe("trial");
    expect(r.canSell).toBe(true);
    expect(r.trialDaysLeft).toBe(1);
  });

  it("trial ends exactly now → expired, cannot sell", () => {
    const r = evaluateSubscription(trialRow({ trial_ends_at: iso(NOW) }), NOW);
    expect(r.state).toBe("trial_expired");
    expect(r.canSell).toBe(false);
  });

  it("trial past end → expired, cannot sell", () => {
    const r = evaluateSubscription(
      trialRow({ trial_started_at: iso(daysAgo(10)), trial_ends_at: iso(daysAgo(3)) }),
      NOW,
    );
    expect(r.state).toBe("trial_expired");
    expect(r.canSell).toBe(false);
  });

  it("trial with no dates defaults end to started + 7 days", () => {
    const r = evaluateSubscription(
      trialRow({ trial_started_at: iso(daysAgo(1)), trial_ends_at: null }),
      NOW,
    );
    expect(r.state).toBe("trial");
    expect(r.canSell).toBe(true);
    expect(r.trialDaysLeft).toBe(6);
  });

  it("active subscription inside period can sell", () => {
    const r = evaluateSubscription(
      trialRow({
        status: "active",
        current_period_start: iso(daysAgo(10)),
        current_period_end: iso(daysAhead(20)),
      }),
      NOW,
    );
    expect(r.state).toBe("active");
    expect(r.canSell).toBe(true);
    expect(r.trialDaysLeft).toBeNull();
  });

  it("active subscription with no period end can sell", () => {
    const r = evaluateSubscription(
      trialRow({ status: "active", current_period_end: null }),
      NOW,
    );
    expect(r.state).toBe("active");
    expect(r.canSell).toBe(true);
  });

  it("active past period end inside grace days → grace, can sell", () => {
    const r = evaluateSubscription(
      trialRow({
        status: "active",
        current_period_end: iso(daysAgo(3)),
        subscription_plans: { grace_days: 7 },
      }),
      NOW,
    );
    expect(r.state).toBe("grace");
    expect(r.canSell).toBe(true);
  });

  it("active past period end + grace elapsed → past_due, cannot sell", () => {
    const r = evaluateSubscription(
      trialRow({
        status: "active",
        current_period_end: iso(daysAgo(10)),
        subscription_plans: { grace_days: 3 },
      }),
      NOW,
    );
    expect(r.state).toBe("past_due");
    expect(r.canSell).toBe(false);
  });

  it("active past period end with zero grace → past_due immediately", () => {
    const r = evaluateSubscription(
      trialRow({
        status: "active",
        current_period_end: iso(daysAgo(1)),
        subscription_plans: { grace_days: 0 },
      }),
      NOW,
    );
    expect(r.state).toBe("past_due");
    expect(r.canSell).toBe(false);
  });

  it("suspended → cannot sell", () => {
    expect(evaluateSubscription(trialRow({ status: "suspended" }), NOW).canSell).toBe(false);
  });

  it("cancelled → cannot sell", () => {
    expect(evaluateSubscription(trialRow({ status: "cancelled" }), NOW).canSell).toBe(false);
  });

  it("unknown status fails closed", () => {
    const r = evaluateSubscription(trialRow({ status: "weird_future_status" }), NOW);
    expect(r.canSell).toBe(false);
    expect(r.state).toBe("suspended");
  });
});

describe("blockedMessage", () => {
  it("explains each blocked state", () => {
    expect(blockedMessage("trial_expired")).toMatch(/trial has ended/i);
    expect(blockedMessage("past_due")).toMatch(/overdue/i);
    expect(blockedMessage("suspended")).toMatch(/suspended/i);
    expect(blockedMessage("cancelled")).toMatch(/cancelled/i);
  });
  it("empty for sellable states", () => {
    expect(blockedMessage("trial")).toBe("");
    expect(blockedMessage("active")).toBe("");
    expect(blockedMessage("grace")).toBe("");
    expect(blockedMessage("none")).toBe("");
  });
});
