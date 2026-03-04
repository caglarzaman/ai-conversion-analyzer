import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { analyzeStore } from "../services/ai-analyzer.server";
import { runFullScan } from "../services/scanner.server";
import db from "../db.server";

// ─── Loader ───────────────────────────────────────────────────────────────────
// Loads real-time quick stats (first 50 products) + the latest persisted scan.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

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

  const outOfStock   = products.filter((p) => p.totalInventory === 0 && p.status === "ACTIVE");
  const lowInventory = products.filter((p) => p.totalInventory > 0 && p.totalInventory < 5);
  const active       = products.filter((p) => p.status === "ACTIVE");
  const draft        = products.filter((p) => p.status === "DRAFT");

  const penalty = outOfStock.length * 10 + lowInventory.length * 5 + draft.length * 2;
  const conversionScore = Math.max(0, Math.min(100, 100 - penalty));

  const atRisk = [
    ...outOfStock.map((p) => ({ ...p, riskLevel: "out-of-stock" as const })),
    ...lowInventory.map((p) => ({ ...p, riskLevel: "low-inventory" as const })),
  ].slice(0, 20);

  // Live AI — only when issues exist (cost guard)
  let liveAiInsights: string | null = null;
  const hasIssues = outOfStock.length > 0 || lowInventory.length > 0 || draft.length > 0;
  if (hasIssues) {
    liveAiInsights = await analyzeStore({
      totalProducts:  products.length,
      outOfStock:     outOfStock.length,
      lowInventory:   lowInventory.length,
      activeProducts: active.length,
      draftProducts:  draft.length,
      riskyTitles:    atRisk.slice(0, 5).map((p) => p.title),
    });
  }

  // Latest persisted scan report for this shop
  const latestReport = await db.scanReport.findFirst({
    where:   { shop: session.shop },
    orderBy: { createdAt: "desc" },
    include: { issues: true },
  });

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
    liveAiInsights,
    latestReport,
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────
// Triggered by the "Scan Store" button — runs a full paginated scan.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const report = await runFullScan(admin, session.shop);
    return { ok: true as const, report };
  } catch (err) {
    console.error("Full scan failed:", err);
    return { ok: false as const, report: null };
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatDate(d: string | Date) {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const ISSUE_LABEL: Record<string, string> = {
  "out-of-stock":  "❌ Out of Stock",
  "low-inventory": "⚠️ Low Inventory",
  draft:           "📝 Draft",
};

const ISSUE_COLORS: Record<string, { bg: string; text: string }> = {
  "out-of-stock":  { bg: "#fff4f4", text: "#d72c0d" },
  "low-inventory": { bg: "#fff8ed", text: "#b98900" },
  draft:           { bg: "#f4f6f8", text: "#6d7175" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function IssueTable({ issues }: { issues: Array<{ id: string; title: string; inventory: number; status: string; issueType: string }> }) {
  if (issues.length === 0) {
    return (
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-paragraph>✅ No issues detected in this scan.</s-paragraph>
      </s-box>
    );
  }

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 90px 90px 140px",
        gap: "12px",
        padding: "0 0 10px",
        fontSize: "11px", fontWeight: "600", color: "#6d7175",
        textTransform: "uppercase", letterSpacing: "0.6px",
        borderBottom: "1px solid #e4e5e7",
      }}>
        <span>Product</span>
        <span style={{ textAlign: "right" }}>Inventory</span>
        <span style={{ textAlign: "center" }}>Status</span>
        <span style={{ textAlign: "center" }}>Issue</span>
      </div>

      {issues.map((p, i) => {
        const colors = ISSUE_COLORS[p.issueType] ?? { bg: "#f4f6f8", text: "#6d7175" };
        return (
          <div key={p.id} style={{
            display: "grid",
            gridTemplateColumns: "1fr 90px 90px 140px",
            gap: "12px",
            padding: "10px 0",
            alignItems: "center",
            fontSize: "14px",
            borderBottom: i < issues.length - 1 ? "1px solid #f1f2f3" : "none",
          }}>
            <span style={{ fontWeight: "500", color: "#202223" }}>{p.title}</span>
            <span style={{ textAlign: "right", fontWeight: "700", color: colors.text }}>{p.inventory}</span>
            <span style={{ textAlign: "center", fontSize: "12px", color: "#6d7175" }}>{p.status}</span>
            <span style={{
              textAlign: "center", fontSize: "12px", fontWeight: "600",
              padding: "3px 10px", borderRadius: "4px",
              backgroundColor: colors.bg, color: colors.text,
            }}>
              {ISSUE_LABEL[p.issueType] ?? p.issueType}
            </span>
          </div>
        );
      })}
    </s-box>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const {
    conversionScore, totalProducts,
    outOfStockCount, lowInventoryCount, activeCount, draftCount,
    atRisk, liveAiInsights, latestReport,
  } = loaderData;

  const isScanning = fetcher.state !== "idle";

  // Prefer freshly-returned scan data over the persisted one
  const scanReport = fetcher.data?.ok ? fetcher.data.report : latestReport;
  const scanFailed = fetcher.data?.ok === false;

  const liveColor = scoreColor(conversionScore);
  const liveLabel = scoreLabel(conversionScore);
  const totalLiveIssues = outOfStockCount + lowInventoryCount;

  return (
    <s-page heading="AI Conversion Analyzer">

      {/* ── LIVE DASHBOARD ── */}

      <s-grid columns="2" gap="base">

        {/* Live Score Card */}
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Live Conversion Score</s-heading>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0 12px", gap: "6px" }}>
            <div style={{ fontSize: "72px", fontWeight: "700", lineHeight: "1", color: liveColor }}>
              {conversionScore}
            </div>
            <div style={{ fontSize: "16px", fontWeight: "600", color: liveColor }}>{liveLabel}</div>
            <div style={{ fontSize: "13px", color: "#6d7175" }}>out of 100 · first 50 products</div>
          </div>
          <s-paragraph>
            {totalLiveIssues === 0
              ? "No inventory issues detected in your latest products."
              : `${totalLiveIssues} issue${totalLiveIssues !== 1 ? "s" : ""} detected in your latest products.`}
          </s-paragraph>
        </s-box>

        {/* Live AI Insights */}
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Live AI Insights</s-heading>
          {liveAiInsights ? (
            <div style={{ marginTop: "12px", fontSize: "14px", lineHeight: "1.8", whiteSpace: "pre-line", color: "#202223" }}>
              {liveAiInsights}
            </div>
          ) : (
            <div style={{ marginTop: "12px" }}>
              <s-paragraph>
                ✅ No critical issues found in your latest products. Run a full scan below to check your entire catalogue.
              </s-paragraph>
            </div>
          )}
        </s-box>

      </s-grid>

      {/* Issues Summary */}
      <s-section heading="Issues Summary">
        <s-grid columns="4" gap="base">

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "36px", fontWeight: "700", color: "#202223" }}>{totalProducts}</div>
              <s-paragraph>Total Products</s-paragraph>
            </div>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "36px", fontWeight: "700", color: activeCount > 0 ? "#008060" : "#6d7175" }}>{activeCount}</div>
              <s-paragraph>Active</s-paragraph>
            </div>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "36px", fontWeight: "700", color: lowInventoryCount > 0 ? "#b98900" : "#6d7175" }}>{lowInventoryCount}</div>
              <s-paragraph>Low Inventory</s-paragraph>
            </div>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "36px", fontWeight: "700", color: outOfStockCount > 0 ? "#d72c0d" : "#6d7175" }}>{outOfStockCount}</div>
              <s-paragraph>Out of Stock</s-paragraph>
            </div>
          </s-box>

        </s-grid>

        {draftCount > 0 && (
          <div style={{ marginTop: "12px" }}>
            <s-paragraph>⚠️ {draftCount} product{draftCount !== 1 ? "s are" : " is"} still in Draft — publish them to improve your score.</s-paragraph>
          </div>
        )}
      </s-section>

      {/* Live Products at Risk */}
      <s-section heading="Products at Risk (Live)">
        {atRisk.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>✅ No at-risk products in your latest 50. Run a full scan to check your entire catalogue.</s-paragraph>
          </s-box>
        ) : (
          <IssueTable issues={atRisk.map((p) => ({ ...p, id: p.id, issueType: p.riskLevel }))} />
        )}
      </s-section>

      {/* ── FULL STORE SCAN ── */}

      <s-section heading="Full Store Scan">

        {/* Scan trigger */}
        <s-box padding="base" borderWidth="base" borderRadius="base">

          {isScanning ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "24px 0" }}>
              <div style={{
                width: "48px", height: "48px", borderRadius: "50%",
                border: "4px solid #e4e5e7", borderTopColor: "#008060",
                animation: "spin 0.9s linear infinite",
              }} />
              <div style={{ fontSize: "16px", fontWeight: "600", color: "#202223" }}>Scanning your entire store...</div>
              <s-paragraph>Fetching all products and running AI analysis. This may take a moment.</s-paragraph>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <s-paragraph>
                Run a full scan to analyze every product in your store, detect all conversion issues, and get personalized AI recommendations.
              </s-paragraph>
              <div>
                <fetcher.Form method="post">
                  <s-button type="submit">
                    {scanReport ? "Rescan Store" : "Scan Store"}
                  </s-button>
                </fetcher.Form>
              </div>
              {scanFailed && (
                <s-paragraph>❌ Scan failed. Please try again.</s-paragraph>
              )}
            </div>
          )}

        </s-box>

        {/* Scan Report */}
        {scanReport && !isScanning && (() => {
          const sc = scoreColor(scanReport.score);
          const sl = scoreLabel(scanReport.score);
          const totalIssues = scanReport.issues.length;

          return (
            <>
              {/* Report header */}
              <div style={{ marginTop: "16px", padding: "12px 16px", backgroundColor: "#f6f6f7", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#202223" }}>
                  Last Scan Report
                </div>
                <div style={{ display: "flex", gap: "16px", fontSize: "13px", color: "#6d7175" }}>
                  <span>🕐 {formatDate(scanReport.createdAt)}</span>
                  <span>📦 {scanReport.totalProducts} products scanned</span>
                  <span>{totalIssues > 0 ? `⚠️ ${totalIssues} issue${totalIssues !== 1 ? "s" : ""} found` : "✅ No issues"}</span>
                </div>
              </div>

              {/* Score + AI in 2-col */}
              <s-grid columns="2" gap="base">

                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-heading>Scan Score</s-heading>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0 12px", gap: "6px" }}>
                    <div style={{ fontSize: "64px", fontWeight: "700", lineHeight: "1", color: sc }}>{scanReport.score}</div>
                    <div style={{ fontSize: "16px", fontWeight: "600", color: sc }}>{sl}</div>
                    <div style={{ fontSize: "13px", color: "#6d7175" }}>out of 100 · full catalogue</div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: "24px", fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>
                    <span style={{ color: scanReport.outOfStock > 0 ? "#d72c0d" : "inherit" }}>❌ {scanReport.outOfStock} OOS</span>
                    <span style={{ color: scanReport.lowInventory > 0 ? "#b98900" : "inherit" }}>⚠️ {scanReport.lowInventory} low</span>
                    <span>📝 {scanReport.draftCount} draft</span>
                  </div>
                </s-box>

                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-heading>AI Recommendations</s-heading>
                  <div style={{ marginTop: "12px", fontSize: "14px", lineHeight: "1.8", whiteSpace: "pre-line", color: "#202223" }}>
                    {scanReport.aiInsights}
                  </div>
                </s-box>

              </s-grid>

              {/* Full issues table */}
              <div style={{ marginTop: "4px" }}>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#202223", marginBottom: "8px" }}>
                  Detected Issues ({totalIssues})
                </div>
                <IssueTable issues={scanReport.issues} />
              </div>
            </>
          );
        })()}

      </s-section>

    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
