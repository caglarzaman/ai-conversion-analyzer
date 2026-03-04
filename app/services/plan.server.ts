import db from "../db.server";
import { PRO_PLAN, GROWTH_PLAN } from "../shopify.server";

export type Plan = "free" | "pro" | "growth";

export const PLAN_LIMITS = {
  free:   { analyses: 5,         bulk: false, weekly: false, seo: false, rewriter: false },
  pro:    { analyses: Infinity,  bulk: false, weekly: false, seo: true,  rewriter: true  },
  growth: { analyses: Infinity,  bulk: true,  weekly: true,  seo: true,  rewriter: true  },
};

export const PLAN_LABELS: Record<Plan, string> = {
  free:   "Free",
  pro:    "Pro · $19/mo",
  growth: "Growth · $39/mo",
};

const IS_TEST = () =>
  process.env.NODE_ENV !== "production" || process.env.BILLING_TEST === "true";

/** Detect the active Shopify billing plan for this session. */
export async function detectPlan(billing: any): Promise<Plan> {
  try {
    const { appSubscriptions } = await billing.check({
      plans: [PRO_PLAN, GROWTH_PLAN],
      isTest: IS_TEST(),
    });
    if (appSubscriptions.some((s: any) => s.name === GROWTH_PLAN)) return "growth";
    if (appSubscriptions.some((s: any) => s.name === PRO_PLAN))    return "pro";
  } catch {
    /* no subscription */
  }
  return "free";
}

/** Return how many free analyses this shop has used this month. */
export async function getFreeUsage(shop: string): Promise<number> {
  const month = new Date().toISOString().slice(0, 7);
  const row   = await db.freeUsage.findUnique({ where: { shop } });
  if (!row || row.month !== month) return 0;
  return row.analyses;
}

/** Increment free usage counter (call after each analysis for free users). */
export async function incrementFreeUsage(shop: string): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  const row   = await db.freeUsage.findUnique({ where: { shop } });

  if (!row || row.month !== month) {
    // New month — reset
    await db.freeUsage.upsert({
      where:  { shop },
      update: { month, analyses: 1 },
      create: { shop, month, analyses: 1 },
    });
  } else {
    await db.freeUsage.update({
      where: { shop },
      data:  { analyses: { increment: 1 } },
    });
  }
}

/** Subscribe to a plan (cancels existing first). */
export async function subscribeToPlan(billing: any, planName: string): Promise<void> {
  const isTest = IS_TEST();
  // Cancel existing subscription if any
  try {
    const { appSubscriptions } = await billing.check({
      plans: [PRO_PLAN, GROWTH_PLAN], isTest,
    });
    for (const sub of appSubscriptions) {
      await billing.cancel({ subscriptionId: sub.id, isTest, prorate: true });
    }
  } catch { /* none */ }

  await billing.request({ plan: planName, isTest });
}

/** Cancel the active subscription. */
export async function cancelSubscription(billing: any): Promise<void> {
  const isTest = IS_TEST();
  try {
    const { appSubscriptions } = await billing.check({
      plans: [PRO_PLAN, GROWTH_PLAN], isTest,
    });
    for (const sub of appSubscriptions) {
      await billing.cancel({ subscriptionId: sub.id, isTest, prorate: true });
    }
  } catch { /* none */ }
}
