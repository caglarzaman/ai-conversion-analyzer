import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { analyzeStore } from "../services/ai-analyzer.server";
import { runFullScan } from "../services/scanner.server";
import db from "../db.server";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`#graphql
    query GetProducts {
      products(first: 50) {
        edges {
          node { id title totalInventory status }
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

  let liveAiInsights: string | null = null;
  const hasIssues = outOfStock.length > 0 || lowInventory.length > 0 || draft.length > 0;
  if (hasIssues) {
    liveAiInsights = await analyzeStore({
      totalProducts: products.length,
      outOfStock: outOfStock.length,
      lowInventory: lowInventory.length,
      activeProducts: active.length,
      draftProducts: draft.length,
      riskyTitles: atRisk.slice(0, 5).map((p) => p.title),
    });
  }

  const latestReport = await db.scanReport.findFirst({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    include: { issues: true },
  });

  return {
    conversionScore,
    totalProducts: products.length,
    outOfStockCount: outOfStock.length,
    lowInventoryCount: lowInventory.length,
    activeCount: active.length,
    draftCount: draft.length,
    atRisk: atRisk.map((p) => ({
      id: p.id, title: p.title,
      inventory: p.totalInventory, status: p.status as string, riskLevel: p.riskLevel,
    })),
    liveAiInsights,
    latestReport,
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────

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

function scoreGradient(score: number) {
  if (score >= 80) return "linear-gradient(135deg, #00b374 0%, #004c3f 100%)";
  if (score >= 60) return "linear-gradient(135deg, #f0a800 0%, #b97d00 100%)";
  if (score >= 40) return "linear-gradient(135deg, #e07c00 0%, #9e4e00 100%)";
  return "linear-gradient(135deg, #e32b2b 0%, #8b0000 100%)";
}

function scoreLabel(score: number) {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Needs Attention";
  return "Critical";
}

function scoreEmoji(score: number) {
  if (score >= 80) return "🚀";
  if (score >= 60) return "👍";
  if (score >= 40) return "⚠️";
  return "🚨";
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const globalCss = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  .aca-card {
    background: #ffffff;
    border-radius: 16px;
    border: 1px solid #e4e5e7;
    padding: 24px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
    animation: fadeIn 0.4s ease both;
  }
  .aca-card:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
    transition: box-shadow 0.2s ease;
  }
  .aca-stat-card {
    border-radius: 16px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: fadeIn 0.4s ease both;
  }
  .aca-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  .aca-grid-4 {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
  .aca-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    opacity: 0.75;
  }
  .aca-section-title {
    font-size: 18px;
    font-weight: 700;
    color: #1a1d1f;
    margin: 0 0 16px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .aca-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
  }
  .aca-table-row {
    display: grid;
    grid-template-columns: 1fr 80px 80px 150px;
    gap: 12px;
    padding: 12px 16px;
    align-items: center;
    border-bottom: 1px solid #f1f2f3;
    font-size: 14px;
    transition: background 0.15s;
  }
  .aca-table-row:hover { background: #fafbfb; }
  .aca-table-row:last-child { border-bottom: none; }
  .aca-scan-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 14px 28px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    border: none;
    background: linear-gradient(135deg, #00b374 0%, #008060 100%);
    color: white;
    box-shadow: 0 4px 14px rgba(0,128,96,0.35);
    transition: all 0.2s ease;
    letter-spacing: 0.2px;
  }
  .aca-scan-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(0,128,96,0.45);
  }
  .aca-scan-btn:active:not(:disabled) { transform: translateY(0); }
  .aca-scan-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
  .aca-insight-line {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: #f6faf8;
    border-radius: 10px;
    border-left: 3px solid #008060;
    font-size: 14px;
    line-height: 1.6;
    color: #1a1d1f;
  }
  .aca-progress-ring {
    transform: rotate(-90deg);
  }
  .aca-spinner {
    width: 44px; height: 44px;
    border-radius: 50%;
    border: 4px solid #e4e5e7;
    border-top-color: #008060;
    animation: spin 0.8s linear infinite;
  }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreRing({ score, size = 140 }: { score: number; size?: number }) {
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? "#00b374" : score >= 60 ? "#f0a800" : score >= 40 ? "#e07c00" : "#e32b2b";

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} className="aca-progress-ring">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e4e5e7" strokeWidth="10" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: "32px", fontWeight: "800", color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: "11px", color: "#6d7175", fontWeight: "600", marginTop: "2px" }}>/ 100</span>
      </div>
    </div>
  );
}

function StatCard({
  value, label, icon, bg, color, delay = "0s",
}: { value: number; label: string; icon: string; bg: string; color: string; delay?: string }) {
  return (
    <div className="aca-stat-card" style={{ background: bg, animationDelay: delay }}>
      <div style={{ fontSize: "28px" }}>{icon}</div>
      <div style={{ fontSize: "32px", fontWeight: "800", color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "13px", fontWeight: "600", color, opacity: 0.75 }}>{label}</div>
    </div>
  );
}

function IssueTag({ type }: { type: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    "out-of-stock":  { label: "Out of Stock",  bg: "#fff0f0", color: "#c0392b" },
    "low-inventory": { label: "Low Inventory", bg: "#fff8ed", color: "#b97d00" },
    draft:           { label: "Draft",         bg: "#f4f6f8", color: "#5c6ac4" },
  };
  const s = map[type] ?? { label: type, bg: "#f4f6f8", color: "#6d7175" };
  return (
    <span className="aca-badge" style={{ background: s.bg, color: s.color }}>
      {type === "out-of-stock" ? "❌" : type === "low-inventory" ? "⚠️" : "📝"} {s.label}
    </span>
  );
}

function IssueTable({ issues }: {
  issues: Array<{ id: string; title: string; inventory: number; status: string; issueType: string }>;
}) {
  if (issues.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "#6d7175" }}>
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>✅</div>
        <div style={{ fontWeight: "600", fontSize: "15px" }}>No issues detected</div>
        <div style={{ fontSize: "13px", marginTop: "4px" }}>Your store looks great!</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 80px 80px 150px",
        gap: "12px", padding: "10px 16px",
        fontSize: "11px", fontWeight: "700", color: "#6d7175",
        textTransform: "uppercase", letterSpacing: "0.7px",
        borderBottom: "2px solid #e4e5e7", marginBottom: "4px",
      }}>
        <span>Product</span>
        <span style={{ textAlign: "right" }}>Stock</span>
        <span style={{ textAlign: "center" }}>Status</span>
        <span style={{ textAlign: "center" }}>Issue</span>
      </div>

      {issues.map((p) => (
        <div key={p.id} className="aca-table-row">
          <span style={{ fontWeight: "600", color: "#1a1d1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.title}
          </span>
          <span style={{
            textAlign: "right", fontWeight: "700",
            color: p.inventory === 0 ? "#c0392b" : p.inventory < 5 ? "#b97d00" : "#1a1d1f",
          }}>
            {p.inventory}
          </span>
          <span style={{ textAlign: "center" }}>
            <span className="aca-badge" style={{
              background: p.status === "ACTIVE" ? "#f0faf5" : "#f4f6f8",
              color: p.status === "ACTIVE" ? "#008060" : "#5c6ac4",
            }}>
              {p.status === "ACTIVE" ? "Active" : "Draft"}
            </span>
          </span>
          <span style={{ textAlign: "center" }}>
            <IssueTag type={p.issueType} />
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const {
    conversionScore, totalProducts,
    outOfStockCount, lowInventoryCount, activeCount, draftCount,
    atRisk, liveAiInsights, latestReport,
  } = loaderData;

  const isScanning = fetcher.state !== "idle";
  const scanReport = fetcher.data?.ok ? fetcher.data.report : latestReport;
  const scanFailed = fetcher.data?.ok === false;

  const aiLines = liveAiInsights
    ? liveAiInsights.split("\n").map((l) => l.trim()).filter(Boolean)
    : [];

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "28px 20px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{globalCss}</style>

      {/* ── Header ── */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "26px", fontWeight: "800", color: "#1a1d1f", letterSpacing: "-0.5px" }}>
              🛍️ AI Conversion Analyzer
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: "14px", color: "#6d7175" }}>
              Real-time insights for your Shopify store · {totalProducts} products loaded
            </p>
          </div>

          {/* Scan button in header */}
          <fetcher.Form method="post">
            <button type="submit" className="aca-scan-btn" disabled={isScanning}>
              {isScanning
                ? <><div className="aca-spinner" style={{ width: 18, height: 18, borderWidth: 3 }} /> Scanning...</>
                : <><span style={{ fontSize: "18px" }}>🔍</span> {scanReport ? "Rescan Store" : "Scan Full Store"}</>
              }
            </button>
          </fetcher.Form>
        </div>
      </div>

      {/* ── Score + Stats ── */}
      <div className="aca-grid-2" style={{ marginBottom: "20px" }}>

        {/* Score Card */}
        <div className="aca-card" style={{ background: scoreGradient(conversionScore), border: "none", color: "white" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <div style={{ position: "relative", width: 140, height: 140, flexShrink: 0 }}>
              <svg width={140} height={140} style={{ transform: "rotate(-90deg)" }}>
                <circle cx={70} cy={70} r={58} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="10" />
                <circle
                  cx={70} cy={70} r={58} fill="none"
                  stroke="white" strokeWidth="10"
                  strokeDasharray={2 * Math.PI * 58}
                  strokeDashoffset={2 * Math.PI * 58 - (conversionScore / 100) * 2 * Math.PI * 58}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 1.2s ease" }}
                />
              </svg>
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: "36px", fontWeight: "800", color: "white", lineHeight: 1 }}>{conversionScore}</span>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.8)", fontWeight: "600", marginTop: "2px" }}>/ 100</span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: "13px", fontWeight: "700", opacity: 0.8, letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: "6px" }}>
                Conversion Score
              </div>
              <div style={{ fontSize: "28px", fontWeight: "800", lineHeight: 1, marginBottom: "8px" }}>
                {scoreEmoji(conversionScore)} {scoreLabel(conversionScore)}
              </div>
              <div style={{ fontSize: "13px", opacity: 0.85, lineHeight: 1.6 }}>
                Based on your latest 50 products.<br />
                {outOfStockCount + lowInventoryCount === 0
                  ? "No inventory issues detected! 🎉"
                  : `${outOfStockCount + lowInventoryCount} issue${outOfStockCount + lowInventoryCount !== 1 ? "s" : ""} impacting your score.`
                }
              </div>
            </div>
          </div>
        </div>

        {/* Stat grid */}
        <div className="aca-grid-4" style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
          <StatCard value={activeCount}       label="Active"       icon="✅" bg="#f0faf5" color="#008060" delay="0.05s" />
          <StatCard value={outOfStockCount}   label="Out of Stock" icon="❌" bg="#fff0f0" color="#c0392b" delay="0.1s"  />
          <StatCard value={lowInventoryCount} label="Low Stock"    icon="⚠️" bg="#fff8ed" color="#b97d00" delay="0.15s" />
          <StatCard value={draftCount}        label="Drafts"       icon="📝" bg="#f0f1ff" color="#5c6ac4" delay="0.2s"  />
        </div>

      </div>

      {/* ── AI Insights ── */}
      {aiLines.length > 0 && (
        <div className="aca-card" style={{ marginBottom: "20px" }}>
          <h2 className="aca-section-title">
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: "8px",
              background: "linear-gradient(135deg, #667eea, #764ba2)", fontSize: "16px",
            }}>🤖</span>
            Live AI Insights
            <span className="aca-badge" style={{ background: "#f0f1ff", color: "#5c6ac4", marginLeft: "auto", fontSize: "11px" }}>
              Powered by Claude
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {aiLines.map((line, i) => (
              <div key={i} className="aca-insight-line">
                <span style={{ flexShrink: 0, fontSize: "16px" }}>
                  {line.startsWith("•") || line.startsWith("-") ? "💡" : "→"}
                </span>
                <span>{line.replace(/^[•\-]\s*/, "")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Products at Risk ── */}
      {atRisk.length > 0 && (
        <div className="aca-card" style={{ marginBottom: "20px" }}>
          <h2 className="aca-section-title">
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: "8px",
              background: "#fff0f0", fontSize: "16px",
            }}>🚨</span>
            Products at Risk
            <span className="aca-badge" style={{ background: "#fff0f0", color: "#c0392b", marginLeft: "8px" }}>
              {atRisk.length} products
            </span>
          </h2>
          <IssueTable issues={atRisk.map((p) => ({ ...p, issueType: p.riskLevel }))} />
        </div>
      )}

      {/* ── Full Store Scan ── */}
      <div className="aca-card" style={{ marginBottom: "20px", border: "2px dashed #e4e5e7" }}>

        {isScanning ? (
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
              <div className="aca-spinner" />
            </div>
            <div style={{ fontSize: "18px", fontWeight: "700", color: "#1a1d1f", marginBottom: "8px" }}>
              Scanning your entire store...
            </div>
            <div style={{ fontSize: "14px", color: "#6d7175" }}>
              Fetching all products, detecting issues & generating AI recommendations.
            </div>
          </div>

        ) : !scanReport ? (
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            <div style={{ fontSize: "56px", marginBottom: "16px" }}>🔍</div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#1a1d1f", marginBottom: "8px" }}>
              Run Your First Full Store Scan
            </div>
            <div style={{ fontSize: "14px", color: "#6d7175", maxWidth: "440px", margin: "0 auto 24px", lineHeight: "1.7" }}>
              Analyze every product in your store — inventory health, draft products, and AI-powered conversion suggestions.
            </div>
            <fetcher.Form method="post">
              <button type="submit" className="aca-scan-btn">
                <span style={{ fontSize: "18px" }}>🚀</span> Start Full Scan
              </button>
            </fetcher.Form>
            {scanFailed && (
              <div style={{ marginTop: "16px", color: "#c0392b", fontSize: "14px" }}>
                ❌ Scan failed. Please try again.
              </div>
            )}
          </div>

        ) : (
          <>
            {/* Report header bar */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              flexWrap: "wrap", gap: "12px", marginBottom: "24px",
              padding: "14px 18px",
              background: "linear-gradient(135deg, #f6faf8, #edf7f4)",
              borderRadius: "12px",
              border: "1px solid #c9ede3",
            }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a1d1f" }}>📋 Last Scan Report</div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>
                  🕐 {formatDate(scanReport.createdAt)}
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <span className="aca-badge" style={{ background: "#e8f5f0", color: "#008060" }}>
                  📦 {scanReport.totalProducts} scanned
                </span>
                <span className="aca-badge" style={{
                  background: scanReport.issues.length > 0 ? "#fff0f0" : "#f0faf5",
                  color: scanReport.issues.length > 0 ? "#c0392b" : "#008060",
                }}>
                  {scanReport.issues.length > 0 ? `⚠️ ${scanReport.issues.length} issues` : "✅ No issues"}
                </span>
              </div>
              <fetcher.Form method="post" style={{ marginLeft: "auto" }}>
                <button type="submit" className="aca-scan-btn" style={{ padding: "10px 20px", fontSize: "13px" }}>
                  🔄 Rescan
                </button>
              </fetcher.Form>
            </div>

            {/* Score + AI side by side */}
            <div className="aca-grid-2" style={{ marginBottom: "20px" }}>

              <div style={{
                background: scoreGradient(scanReport.score),
                borderRadius: "14px", padding: "24px", color: "white",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "12px",
              }}>
                <div style={{ fontSize: "12px", fontWeight: "700", opacity: 0.85, letterSpacing: "0.8px", textTransform: "uppercase" }}>
                  Full Scan Score
                </div>
                <div style={{ fontSize: "72px", fontWeight: "800", lineHeight: 1 }}>{scanReport.score}</div>
                <div style={{ fontSize: "18px", fontWeight: "700" }}>
                  {scoreEmoji(scanReport.score)} {scoreLabel(scanReport.score)}
                </div>
                <div style={{ display: "flex", gap: "16px", fontSize: "13px", opacity: 0.9, marginTop: "4px" }}>
                  <span>❌ {scanReport.outOfStock} OOS</span>
                  <span>⚠️ {scanReport.lowInventory} low</span>
                  <span>📝 {scanReport.draftCount} draft</span>
                </div>
              </div>

              <div style={{ background: "#f8f9ff", borderRadius: "14px", padding: "24px" }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#1a1d1f", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 28, height: 28, borderRadius: "6px",
                    background: "linear-gradient(135deg, #667eea, #764ba2)", fontSize: "14px",
                  }}>🤖</span>
                  AI Recommendations
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {scanReport.aiInsights
                    .split("\n")
                    .map((l: string) => l.trim())
                    .filter(Boolean)
                    .map((line: string, i: number) => (
                      <div key={i} className="aca-insight-line" style={{ background: "white" }}>
                        <span style={{ flexShrink: 0 }}>💡</span>
                        <span>{line.replace(/^[•\-]\s*/, "")}</span>
                      </div>
                    ))}
                </div>
              </div>

            </div>

            {/* Issues table */}
            {scanReport.issues.length > 0 && (
              <div>
                <h3 style={{ margin: "0 0 12px", fontSize: "15px", fontWeight: "700", color: "#1a1d1f" }}>
                  ⚠️ Detected Issues ({scanReport.issues.length})
                </h3>
                <div style={{ borderRadius: "12px", overflow: "hidden", border: "1px solid #e4e5e7" }}>
                  <IssueTable issues={scanReport.issues} />
                </div>
              </div>
            )}
          </>
        )}

      </div>

    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
