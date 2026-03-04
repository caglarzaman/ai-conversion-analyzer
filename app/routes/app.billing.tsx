import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const isTest = process.env.NODE_ENV !== "production";

  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [MONTHLY_PLAN],
    isTest,
  });

  const sub = appSubscriptions[0] ?? null;

  return {
    hasActivePayment,
    plan: {
      name:   MONTHLY_PLAN,
      amount: 19,
      currency: "USD",
      interval: "Every 30 days",
    },
    subscription: sub
      ? { id: sub.id, name: sub.name, test: sub.test }
      : null,
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const isTest = process.env.NODE_ENV !== "production";
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "cancel") {
    const { appSubscriptions } = await billing.check({
      plans: [MONTHLY_PLAN],
      isTest,
    });

    if (appSubscriptions.length > 0) {
      await billing.cancel({
        subscriptionId: appSubscriptions[0].id,
        isTest,
        prorate: true,
      });
    }

    return { cancelled: true };
  }

  if (intent === "subscribe") {
    await billing.request({ plan: MONTHLY_PLAN, isTest });
  }

  return { cancelled: false };
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { hasActivePayment, plan, subscription } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isBusy = fetcher.state !== "idle";
  const justCancelled = fetcher.data?.cancelled === true;

  const active = hasActivePayment && !justCancelled;

  return (
    <s-page heading="Billing">

      {/* Plan card */}
      <s-grid columns="2" gap="base">

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Current Plan</s-heading>

          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", color: "#6d7175" }}>Plan</span>
              <span style={{ fontSize: "14px", fontWeight: "600", color: "#202223" }}>{plan.name}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", color: "#6d7175" }}>Price</span>
              <span style={{ fontSize: "22px", fontWeight: "700", color: "#202223" }}>
                ${plan.amount}
                <span style={{ fontSize: "13px", fontWeight: "400", color: "#6d7175" }}> / month</span>
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", color: "#6d7175" }}>Billing cycle</span>
              <span style={{ fontSize: "14px", color: "#202223" }}>{plan.interval}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", color: "#6d7175" }}>Status</span>
              <span style={{
                fontSize: "12px", fontWeight: "600", padding: "3px 10px", borderRadius: "4px",
                backgroundColor: active ? "#f1faf5" : "#fff4f4",
                color:           active ? "#008060" : "#d72c0d",
              }}>
                {active ? "✅ Active" : "❌ Inactive"}
              </span>
            </div>

            {subscription?.test && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "14px", color: "#6d7175" }}>Mode</span>
                <span style={{
                  fontSize: "12px", fontWeight: "600", padding: "3px 10px", borderRadius: "4px",
                  backgroundColor: "#fff8ed", color: "#b98900",
                }}>
                  🧪 Test charge
                </span>
              </div>
            )}

          </div>
        </s-box>

        {/* What's included */}
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>What's Included</s-heading>
          <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              "Full store scan — analyze up to 2,500 products",
              "AI-powered conversion suggestions",
              "Inventory issue detection",
              "Persisted scan reports",
              "Live dashboard with real-time score",
            ].map((feature) => (
              <div key={feature} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "14px", color: "#202223" }}>
                <span style={{ color: "#008060", flexShrink: 0 }}>✓</span>
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </s-box>

      </s-grid>

      {/* Actions */}
      <s-section heading="Manage Subscription">
        <s-box padding="base" borderWidth="base" borderRadius="base">

          {active ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <s-paragraph>
                Your subscription is active. You can cancel at any time — you'll be prorated for any unused days.
              </s-paragraph>
              <div>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="cancel" />
                  <s-button
                    tone="critical"
                    onclick={(e: Event) => {
                      if (!confirm("Cancel your subscription? You'll lose access at the end of your billing period.")) {
                        e.preventDefault();
                      }
                    }}
                  >
                    {isBusy ? "Cancelling..." : "Cancel Subscription"}
                  </s-button>
                </fetcher.Form>
              </div>
              {justCancelled && (
                <s-paragraph>✅ Subscription cancelled. You'll retain access until the end of the current billing period.</s-paragraph>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <s-paragraph>
                Subscribe to unlock full store scanning, AI insights, and conversion reports for $19/month.
              </s-paragraph>
              <div>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="subscribe" />
                  <s-button>
                    {isBusy ? "Redirecting..." : "Subscribe — $19 / month"}
                  </s-button>
                </fetcher.Form>
              </div>
            </div>
          )}

        </s-box>
      </s-section>

    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
