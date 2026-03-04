import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, PRO_PLAN, GROWTH_PLAN } from "../shopify.server";
import { detectPlan } from "../services/plan.server";
import { getUsage } from "../services/usage.server";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const isTest = process.env.NODE_ENV !== "production" || process.env.BILLING_TEST === "true";

  const plan  = await detectPlan(billing);
  const usage = await getUsage(session.shop);

  const { appSubscriptions } = await billing.check({
    plans: [PRO_PLAN, GROWTH_PLAN], isTest,
  }).catch(() => ({ appSubscriptions: [] as any[] }));

  const activeSub = appSubscriptions[0] ?? null;

  return { plan, usage, testMode: activeSub?.test ?? false };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const isTest    = process.env.NODE_ENV !== "production" || process.env.BILLING_TEST === "true";
  const formData  = await request.formData();
  const intent    = formData.get("intent") as string;

  if (intent === "subscribe-pro") {
    await billing.request({ plan: PRO_PLAN, isTest });
    return { cancelled: false };
  }
  if (intent === "subscribe-growth") {
    await billing.request({ plan: GROWTH_PLAN, isTest });
    return { cancelled: false };
  }
  if (intent === "cancel") {
    const { appSubscriptions } = await billing.check({
      plans: [PRO_PLAN, GROWTH_PLAN], isTest,
    }).catch(() => ({ appSubscriptions: [] as any[] }));
    for (const sub of appSubscriptions) {
      await billing.cancel({ subscriptionId: sub.id, isTest, prorate: true });
    }
    return { cancelled: true };
  }

  return { cancelled: false };
};

// ─── Plan feature lists ────────────────────────────────────────────────────────

const PLAN_FEATURES = {
  free: [
    "5 product analyses per month",
    "Live dashboard & conversion score",
    "Inventory issue detection",
    "Scan history (last 10 reports)",
    "Products at Risk table",
  ],
  pro: [
    "Unlimited product analyses",
    "SEO Optimizer (AI-powered)",
    "AI Description Rewriter",
    "Full store scan up to 2,500 products",
    "Everything in Free",
  ],
  growth: [
    "Bulk analysis for all products",
    "Auto-fix button (title + description)",
    "Weekly AI store report",
    "Priority product scoring",
    "Everything in Pro",
  ],
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { plan, usage, testMode } = useLoaderData<typeof loader>();
  const fetcher    = useFetcher<typeof action>();   // only used for cancel
  const navigation = useNavigation();

  const isNavigating  = navigation.state !== "idle";
  const isCancelling  = fetcher.state !== "idle";
  const justCancelled = fetcher.data?.cancelled === true;
  const currentPlan   = justCancelled ? "free" : plan;

  return (
    <div style={{
      maxWidth: "1040px", margin: "0 auto",
      padding: "28px 20px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>

      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: "800", color: "#1a1d1f", letterSpacing: "-0.4px" }}>
          Plans & Billing
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#6d7175" }}>
          Upgrade anytime. Cancel anytime. All plans billed via Shopify.
        </p>
      </div>

      {/* Plan Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px", marginBottom: "32px" }}>

        {/* Free */}
        <PlanCard
          name="Free"
          price={null}
          tagline="Get started with basic insights"
          features={PLAN_FEATURES.free}
          highlight={false}
          badge={null}
          current={currentPlan === "free"}
          intent={null}
          fetcher={fetcher}
          isNavigating={isNavigating}
          isCancelling={isCancelling}
          showCancel={false}
        />

        {/* Pro */}
        <PlanCard
          name="Pro"
          price={19}
          tagline="AI-powered tools for growing stores"
          features={PLAN_FEATURES.pro}
          highlight
          badge="Most Popular"
          current={currentPlan === "pro"}
          intent="subscribe-pro"
          fetcher={fetcher}
          isNavigating={isNavigating}
          isCancelling={isCancelling}
          showCancel={currentPlan === "pro"}
        />

        {/* Growth */}
        <PlanCard
          name="Growth"
          price={39}
          tagline="Full automation for scaling stores"
          features={PLAN_FEATURES.growth}
          highlight={false}
          badge={null}
          current={currentPlan === "growth"}
          intent="subscribe-growth"
          fetcher={fetcher}
          isNavigating={isNavigating}
          isCancelling={isCancelling}
          showCancel={currentPlan === "growth"}
        />

      </div>

      {/* Notices */}
      {justCancelled && (
        <div style={{
          marginBottom: "20px", padding: "14px 18px",
          background: "#f0faf5", border: "1px solid #c9ede3",
          borderRadius: "12px", fontSize: "14px", color: "#008060",
        }}>
          ✅ Subscription cancelled. You'll retain access until the end of your billing period.
        </div>
      )}
      {testMode && (
        <div style={{
          marginBottom: "20px", padding: "12px 16px",
          background: "#fff8ed", border: "1px solid #f5d9a8",
          borderRadius: "12px", fontSize: "13px", color: "#b98900",
        }}>
          🧪 <strong>Test mode active.</strong> Charges are simulated and won't be billed to a real card.
        </div>
      )}

      {/* AI Usage */}
      <div style={{ background: "#fff", border: "1px solid #e4e5e7", borderRadius: "16px", padding: "24px" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: "700", color: "#1a1d1f" }}>
          🤖 AI Usage This Month
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {[
            { value: String(usage.calls),                 label: "AI Calls",      color: "#667eea" },
            { value: usage.tokens.toLocaleString(),       label: "Tokens Used",   color: "#667eea" },
            { value: `$${usage.costUsd}`,                 label: "Est. Cost",     color: "#008060" },
          ].map(({ value, label, color }) => (
            <div key={label} style={{ textAlign: "center", padding: "16px", background: "#f8f9fb", borderRadius: "12px" }}>
              <div style={{ fontSize: "28px", fontWeight: "800", color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px", fontWeight: "600" }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "12px", padding: "10px 14px", background: "#f0faf5", borderRadius: "8px", fontSize: "13px", color: "#008060" }}>
          💚 All AI calls use <strong>Claude Haiku</strong> — the most cost-efficient model available.
        </div>
      </div>

    </div>
  );
}

// ─── PlanCard component ───────────────────────────────────────────────────────

function PlanCard({
  name, price, tagline, features, highlight, badge, current, intent,
  fetcher, isNavigating, isCancelling, showCancel,
}: {
  name: string; price: number | null; tagline: string; features: string[];
  highlight: boolean; badge: string | null; current: boolean;
  intent: string | null; fetcher: any;
  isNavigating: boolean; isCancelling: boolean; showCancel: boolean;
}) {
  return (
    <div style={{
      position: "relative",
      background:    highlight ? "linear-gradient(160deg, #f3f4ff 0%, #eaecff 100%)" : "#fff",
      border:        current   ? "2px solid #667eea" : highlight ? "1.5px solid #c5c9ff" : "1px solid #e4e5e7",
      borderRadius:  "18px",
      padding:       "28px 24px 24px",
      display:       "flex",
      flexDirection: "column",
      boxShadow:     highlight ? "0 4px 24px rgba(102,126,234,0.12)" : "0 1px 4px rgba(0,0,0,0.04)",
    }}>

      {/* Badge */}
      {badge && (
        <div style={{
          position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)",
          background: "linear-gradient(135deg, #667eea, #764ba2)",
          color: "white", fontSize: "11px", fontWeight: "700",
          padding: "4px 16px", borderRadius: "20px", whiteSpace: "nowrap",
        }}>
          {badge}
        </div>
      )}

      {/* Current tag */}
      {current && (
        <div style={{
          position: "absolute", top: "16px", right: "16px",
          background: "#f0f1ff", color: "#667eea",
          fontSize: "10px", fontWeight: "800",
          padding: "3px 8px", borderRadius: "6px",
          textTransform: "uppercase", letterSpacing: "0.5px",
        }}>
          Current
        </div>
      )}

      {/* Name + price */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "17px", fontWeight: "800", color: "#1a1d1f" }}>{name}</div>
        <div style={{ marginTop: "10px" }}>
          {price != null ? (
            <>
              <span style={{ fontSize: "38px", fontWeight: "800", color: highlight ? "#667eea" : "#1a1d1f", lineHeight: 1 }}>
                ${price}
              </span>
              <span style={{ fontSize: "13px", color: "#6d7175" }}>/month</span>
            </>
          ) : (
            <span style={{ fontSize: "38px", fontWeight: "800", color: "#1a1d1f", lineHeight: 1 }}>Free</span>
          )}
        </div>
        <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "6px", lineHeight: 1.5 }}>{tagline}</div>
      </div>

      {/* Features */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "9px", marginBottom: "22px" }}>
        {features.map((f) => (
          <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", color: "#1a1d1f" }}>
            <span style={{ color: "#008060", flexShrink: 0, marginTop: "1px" }}>✓</span>
            <span>{f}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      {current ? (
        showCancel ? (
          // Cancel uses fetcher (stays on page, no redirect)
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <button type="submit" disabled={isCancelling} style={{
              width: "100%", padding: "11px",
              border: "1px solid #e4e5e7", borderRadius: "10px",
              background: "#fff", color: "#6d7175",
              fontSize: "13px", fontWeight: "600", cursor: "pointer",
              transition: "all 0.15s",
            }}>
              {isCancelling ? "Processing..." : "Cancel Plan"}
            </button>
          </fetcher.Form>
        ) : (
          <div style={{
            width: "100%", padding: "11px", textAlign: "center",
            border: "1px solid #e4e5e7", borderRadius: "10px",
            background: "#f8f9fb", color: "#6d7175",
            fontSize: "13px", fontWeight: "600",
          }}>
            ✓ Your current plan
          </div>
        )
      ) : intent ? (
        // Subscribe uses regular Form — billing.request() throws a redirect that
        // needs full-page navigation (not XHR/fetcher) to work with App Bridge
        <Form method="post">
          <input type="hidden" name="intent" value={intent} />
          <button type="submit" disabled={isNavigating} style={{
            width: "100%", padding: "11px",
            border: "none", borderRadius: "10px",
            background: highlight
              ? "linear-gradient(135deg, #667eea, #764ba2)"
              : "linear-gradient(135deg, #1a1d1f, #3d4145)",
            color: "white",
            fontSize: "13px", fontWeight: "700",
            cursor: isNavigating ? "not-allowed" : "pointer",
            opacity: isNavigating ? 0.7 : 1,
            transition: "all 0.15s",
          }}>
            {isNavigating ? "Redirecting to Shopify..." : `Upgrade to ${name} →`}
          </button>
        </Form>
      ) : null}

    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
