import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, MONTHLY_PLAN } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  // Require an active subscription on every authenticated request.
  // If the merchant hasn't subscribed, Shopify redirects them to the
  // billing confirmation page automatically.
  const isTest = process.env.NODE_ENV !== "production" || process.env.BILLING_TEST === "true";
  const billingCheck = await billing.require({
    plans: [MONTHLY_PLAN],
    isTest,
    onFailure: async () => billing.request({ plan: MONTHLY_PLAN, isTest }),
  });

  const subscription = billingCheck.appSubscriptions[0] ?? null;

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    subscription: subscription
      ? { id: subscription.id, name: subscription.name, test: subscription.test }
      : null,
  };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/products">AI Product Analysis</s-link>
        <s-link href="/app/history">Scan History</s-link>
        <s-link href="/app/billing">Billing</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
