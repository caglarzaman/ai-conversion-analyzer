import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const reports = await db.scanReport.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    include: { issues: true },
  });

  return { reports };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 80) return "#00b374";
  if (score >= 60) return "#f0a800";
  if (score >= 40) return "#e07c00";
  return "#e32b2b";
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

const ISSUE_CATEGORIES = [
  { key: "out-of-stock",   label: "Out of Stock",  color: "#c0392b", bg: "#fff0f0", icon: "❌" },
  { key: "low-inventory",  label: "Low Inventory", color: "#b97d00", bg: "#fff8ed", icon: "⚠️" },
  { key: "draft",          label: "Drafts",        color: "#5c6ac4", bg: "#f0f1ff", icon: "📝" },
  { key: "no-description", label: "No Desc",       color: "#6d7175", bg: "#f4f6f8", icon: "📄" },
  { key: "no-images",      label: "No Images",     color: "#6d7175", bg: "#f4f6f8", icon: "🖼️" },
  { key: "short-title",    label: "Short Title",   color: "#6d7175", bg: "#f4f6f8", icon: "✏️" },
];

const css = `
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px);} to {opacity:1;transform:translateY(0);}}
  .h-card {
    background:#fff; border-radius:16px; border:1px solid #e4e5e7;
    padding:24px; box-shadow:0 1px 3px rgba(0,0,0,0.06);
    animation:fadeIn 0.35s ease both;
  }
  .h-card:hover { box-shadow:0 4px 12px rgba(0,0,0,0.08); transition:box-shadow 0.2s; }
  .h-score-bar-wrap {
    height:12px; background:#f1f2f3; border-radius:99px; overflow:hidden;
  }
  .h-score-bar {
    height:100%; border-radius:99px;
    transition: width 0.8s cubic-bezier(0.34,1.56,0.64,1);
  }
  .h-badge {
    display:inline-flex; align-items:center; gap:4px;
    padding:3px 9px; border-radius:20px; font-size:12px; font-weight:600;
  }
  .h-timeline-dot {
    width:12px; height:12px; border-radius:50%; flex-shrink:0; margin-top:4px;
  }
`;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { reports } = useLoaderData<typeof loader>();

  if (reports.length === 0) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <style>{css}</style>
        <div style={{ textAlign: "center", padding: "80px 20px", color: "#6d7175" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📊</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1d1f", marginBottom: 8 }}>No scan history yet</div>
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>Run your first full store scan from the dashboard to start tracking your conversion score over time.</div>
        </div>
      </div>
    );
  }

  // Trend: oldest → newest for chart
  const chartReports = [...reports].reverse();
  const maxScore = 100;

  // Running best/worst
  const bestScore = Math.max(...reports.map((r) => r.score));
  const latestScore = reports[0].score;
  const previousScore = reports[1]?.score ?? null;
  const scoreDelta = previousScore !== null ? latestScore - previousScore : null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1d1f", letterSpacing: "-0.5px" }}>
          📊 Scan History
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6d7175" }}>
          Track your conversion score over time · {reports.length} scan{reports.length !== 1 ? "s" : ""} recorded
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24 }}>
        <div className="h-card" style={{ background: "linear-gradient(135deg,#00b374,#004c3f)", border: "none", color: "white" }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, letterSpacing: "0.7px", textTransform: "uppercase", marginBottom: 8 }}>Latest Score</div>
          <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1 }}>{latestScore}</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>
            {scoreEmoji(latestScore)} {scoreLabel(latestScore)}
            {scoreDelta !== null && (
              <span style={{ marginLeft: 8, fontWeight: 700 }}>
                {scoreDelta > 0 ? `▲ +${scoreDelta}` : scoreDelta < 0 ? `▼ ${scoreDelta}` : "→ No change"}
              </span>
            )}
          </div>
        </div>

        <div className="h-card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6d7175", letterSpacing: "0.7px", textTransform: "uppercase" }}>Best Score</div>
          <div style={{ fontSize: 48, fontWeight: 800, color: scoreColor(bestScore), lineHeight: 1 }}>{bestScore}</div>
          <div style={{ fontSize: 13, color: "#6d7175" }}>{scoreEmoji(bestScore)} All-time high</div>
        </div>

        <div className="h-card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6d7175", letterSpacing: "0.7px", textTransform: "uppercase" }}>Total Scans</div>
          <div style={{ fontSize: 48, fontWeight: 800, color: "#1a1d1f", lineHeight: 1 }}>{reports.length}</div>
          <div style={{ fontSize: 13, color: "#6d7175" }}>🔍 Scans recorded (max 10)</div>
        </div>
      </div>

      {/* Score trend chart */}
      <div className="h-card" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1d1f", marginBottom: 20 }}>📈 Score Trend</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 140 }}>
          {chartReports.map((r, i) => {
            const barH = Math.max(8, (r.score / maxScore) * 120);
            const color = scoreColor(r.score);
            const isLatest = i === chartReports.length - 1;
            return (
              <div key={r.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color }}>
                  {r.score}
                </div>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{
                    width: "100%", height: barH,
                    background: isLatest
                      ? `linear-gradient(180deg, ${color}, ${color}aa)`
                      : `${color}66`,
                    borderRadius: "6px 6px 0 0",
                    border: isLatest ? `2px solid ${color}` : "none",
                    transition: "height 0.6s ease",
                    position: "relative",
                  }}>
                    {isLatest && (
                      <div style={{
                        position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)",
                        fontSize: 10, fontWeight: 700, color, whiteSpace: "nowrap",
                      }}>Latest</div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#6d7175", textAlign: "center", lineHeight: 1.3 }}>
                  {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scan list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {reports.map((r, idx) => {
          const color = scoreColor(r.score);
          const seoCnt = r.issues.filter((i) =>
            ["no-description", "no-images", "short-title"].includes(i.issueType)
          ).length;

          return (
            <div key={r.id} className="h-card" style={{ animationDelay: `${idx * 0.05}s` }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>

                {/* Score circle */}
                <div style={{
                  width: 64, height: 64, borderRadius: "50%", flexShrink: 0,
                  background: `${color}18`, border: `3px solid ${color}`,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{r.score}</span>
                  <span style={{ fontSize: 9, color, fontWeight: 600, opacity: 0.8 }}>/100</span>
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#1a1d1f" }}>
                      {idx === 0 ? "🔴 Latest — " : ""}{scoreEmoji(r.score)} {scoreLabel(r.score)}
                    </span>
                    <span style={{ fontSize: 12, color: "#6d7175" }}>{formatDate(r.createdAt)}</span>
                    {idx === 0 && (
                      <span className="h-badge" style={{ background: "#e8f5f0", color: "#008060" }}>Latest</span>
                    )}
                  </div>

                  {/* Score bar */}
                  <div className="h-score-bar-wrap" style={{ marginBottom: 12 }}>
                    <div className="h-score-bar" style={{ width: `${r.score}%`, background: color }} />
                  </div>

                  {/* Issue breakdown */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    <span className="h-badge" style={{ background: "#f4f6f8", color: "#6d7175" }}>
                      📦 {r.totalProducts} products
                    </span>
                    {r.outOfStock > 0 && (
                      <span className="h-badge" style={{ background: "#fff0f0", color: "#c0392b" }}>
                        ❌ {r.outOfStock} OOS
                      </span>
                    )}
                    {r.lowInventory > 0 && (
                      <span className="h-badge" style={{ background: "#fff8ed", color: "#b97d00" }}>
                        ⚠️ {r.lowInventory} low stock
                      </span>
                    )}
                    {r.draftCount > 0 && (
                      <span className="h-badge" style={{ background: "#f0f1ff", color: "#5c6ac4" }}>
                        📝 {r.draftCount} drafts
                      </span>
                    )}
                    {seoCnt > 0 && (
                      <span className="h-badge" style={{ background: "#f4f6f8", color: "#6d7175" }}>
                        🔎 {seoCnt} SEO issues
                      </span>
                    )}
                    {r.issues.length === 0 && (
                      <span className="h-badge" style={{ background: "#f0faf5", color: "#008060" }}>
                        ✅ No issues
                      </span>
                    )}
                  </div>

                  {/* Issue type breakdown mini-bar */}
                  {r.issues.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {ISSUE_CATEGORIES.map((cat) => {
                        const cnt = r.issues.filter((i) => i.issueType === cat.key).length;
                        if (cnt === 0) return null;
                        return (
                          <div key={cat.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: cat.color }}>
                            <span>{cat.icon}</span>
                            <span style={{ fontWeight: 600 }}>{cnt} {cat.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
