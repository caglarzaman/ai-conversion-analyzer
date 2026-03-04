import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { analyzeStore } from "../services/ai-analyzer.server";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`#graphql
    query GetProducts {
      products(first: 50) {
        edges {
          node {
            id
            title
            totalInventory
            status
          }
        }
      }
    }
  `);

  const data = await response.json();
  const products: any[] = data.data.products.edges.map((e: any) => e.node);

  const outOfStock   = products.filter((p) => p.totalInventory === 0);
  const lowInventory = products.filter((p) => p.totalInventory > 0 && p.totalInventory < 5);
  const active       = products.filter((p) => p.status === "ACTIVE");
  const draft        = products.filter((p) => p.status === "DRAFT");

  // Conversion score: start at 100, deduct per issue, clamp 0–100
  const penalty = outOfStock.length * 10 + lowInventory.length * 5 + draft.length * 2;
  const conversionScore = Math.max(0, Math.min(100, 100 - penalty));

  // At-risk list: out-of-stock first, then low-inventory, capped at 20 rows
  const atRisk = [
    ...outOfStock.map((p) => ({ ...p, riskLevel: "out-of-stock" as const })),
    ...lowInventory.map((p) => ({ ...p, riskLevel: "low-inventory" as const })),
  ].slice(0, 20);

  // AI: only call when there are actual issues — saves cost on healthy stores
  let aiInsights: string | null = null;
  const hasIssues = outOfStock.length > 0 || lowInventory.length > 0 || draft.length > 0;
  if (hasIssues) {
    aiInsights = await analyzeStore({
      totalProducts:  products.length,
      outOfStock:     outOfStock.length,
      lowInventory:   lowInventory.length,
      activeProducts: active.length,
      draftProducts:  draft.length,
      riskyTitles:    atRisk.slice(0, 5).map((p) => p.title),
    });
  }

  return {
    conversionScore,
    totalProducts:     products.length,
    outOfStockCount:   outOfStock.length,
    lowInventoryCount: lowInventory.length,
    activeCount:       active.length,
    draftCount:        draft.length,
    atRisk: atRisk.map((p) => ({
      id:        p.id,
      title:     p.title,
      inventory: p.totalInventory,
      status:    p.status as string,
      riskLevel: p.riskLevel,
    })),
    aiInsights,
  };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreLabel(score: number) {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Needs Attention";
  return "Critical";
}

function scoreColor(score: number) {
  if (score >= 80) return "#008060";
  if (score >= 60) return "#b98900";
  if (score >= 40) return "#e07c00";
  return "#d72c0d";
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Index() {
  const {
    conversionScore,
    totalProducts,
    outOfStockCount,
    lowInventoryCount,
    activeCount,
    draftCount,
    atRisk,
    aiInsights,
  } = useLoaderData<typeof loader>();

  const color = scoreColor(conversionScore);
  const label = scoreLabel(conversionScore);
  const totalIssues = outOfStockCount + lowInventoryCount;

  return (
    <s-page heading="AI Conversion Analyzer">

      {/* ── Row 1: Score Card + AI Insights ── */}
      <s-grid columns="2" gap="base">

        {/* Conversion Score Card */}
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Conversion Score</s-heading>

          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "20px 0 12px",
            gap: "6px",
          }}>
            <div style={{ fontSize: "72px", fontWeight: "700", lineHeight: "1", color }}>
              {conversionScore}
            </div>
            <div style={{ fontSize: "16px", fontWeight: "600", color }}>
              {label}
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175" }}>out of 100</div>
          </div>

          <s-paragraph>
            {totalIssues === 0
              ? "Your store is healthy — no inventory issues detected."
              : `${totalIssues} product issue${totalIssues !== 1 ? "s" : ""} are hurting your conversion score.`}
          </s-paragraph>
        </s-box>

        {/* AI Insights Panel */}
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>AI Insights</s-heading>

          {aiInsights ? (
            <div style={{
              marginTop: "12px",
              fontSize: "14px",
              lineHeight: "1.8",
              whiteSpace: "pre-line",
              color: "#202223",
            }}>
              {aiInsights}
            </div>
          ) : (
            <div style={{ marginTop: "12px" }}>
              <s-paragraph>
                ✅ No critical issues detected. Your store inventory is in good shape.
                Keep monitoring regularly to maintain your score.
              </s-paragraph>
            </div>
          )}
        </s-box>

      </s-grid>

      {/* ── Row 2: Issues Summary ── */}
      <s-section heading="Issues Summary">
        <s-grid columns="4" gap="base">

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "36px", fontWeight: "700", color: "#202223" }}>
                {totalProducts}
              </div>
              <s-paragraph>Total Products</s-paragraph>
            </div>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "36px", fontWeight: "700", color: activeCount > 0 ? "#008060" : "#6d7175" }}>
                {activeCount}
              </div>
              <s-paragraph>Active</s-paragraph>
            </div>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "36px", fontWeight: "700", color: lowInventoryCount > 0 ? "#b98900" : "#6d7175" }}>
                {lowInventoryCount}
              </div>
              <s-paragraph>Low Inventory</s-paragraph>
            </div>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "36px", fontWeight: "700", color: outOfStockCount > 0 ? "#d72c0d" : "#6d7175" }}>
                {outOfStockCount}
              </div>
              <s-paragraph>Out of Stock</s-paragraph>
            </div>
          </s-box>

        </s-grid>

        {draftCount > 0 && (
          <div style={{ marginTop: "12px" }}>
            <s-paragraph>
              ⚠️ {draftCount} product{draftCount !== 1 ? "s are" : " is"} still in Draft — publish them to improve your score.
            </s-paragraph>
          </div>
        )}
      </s-section>

      {/* ── Row 3: Product Risk Table ── */}
      <s-section heading="Products at Risk">
        {atRisk.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>✅ No products at risk. Great job keeping your inventory stocked!</s-paragraph>
          </s-box>
        ) : (
          <s-box padding="base" borderWidth="base" borderRadius="base">

            {/* Table header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 90px 90px 130px",
              gap: "12px",
              padding: "0 0 10px",
              fontSize: "11px",
              fontWeight: "600",
              color: "#6d7175",
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              borderBottom: "1px solid #e4e5e7",
            }}>
              <span>Product</span>
              <span style={{ textAlign: "right" }}>Inventory</span>
              <span style={{ textAlign: "center" }}>Status</span>
              <span style={{ textAlign: "center" }}>Risk Level</span>
            </div>

            {/* Table rows */}
            {atRisk.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px 90px 130px",
                  gap: "12px",
                  padding: "10px 0",
                  alignItems: "center",
                  fontSize: "14px",
                  borderBottom: i < atRisk.length - 1 ? "1px solid #f1f2f3" : "none",
                }}
              >
                <span style={{ fontWeight: "500", color: "#202223" }}>{p.title}</span>

                <span style={{
                  textAlign: "right",
                  fontWeight: "700",
                  color: p.riskLevel === "out-of-stock" ? "#d72c0d" : "#b98900",
                }}>
                  {p.inventory}
                </span>

                <span style={{
                  textAlign: "center",
                  fontSize: "12px",
                  color: "#6d7175",
                }}>
                  {p.status}
                </span>

                <span style={{
                  display: "inline-block",
                  textAlign: "center",
                  fontSize: "12px",
                  fontWeight: "600",
                  padding: "3px 10px",
                  borderRadius: "4px",
                  backgroundColor: p.riskLevel === "out-of-stock" ? "#fff4f4" : "#fff8ed",
                  color: p.riskLevel === "out-of-stock" ? "#d72c0d" : "#b98900",
                }}>
                  {p.riskLevel === "out-of-stock" ? "❌ Out of Stock" : "⚠️ Low Inventory"}
                </span>
              </div>
            ))}

          </s-box>
        )}
      </s-section>

      {/* ── Row 4: Rescan Action ── */}
      <s-section heading="Store Scan">
        <s-button onclick={() => window.location.reload()}>Rescan Store</s-button>
        <s-paragraph>
          Fetch fresh product data and regenerate AI insights for your store.
        </s-paragraph>
      </s-section>

    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
