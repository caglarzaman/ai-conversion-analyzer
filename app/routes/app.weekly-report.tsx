import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import Anthropic from "@anthropic-ai/sdk";
import db from "../db.server";
import { trackUsage } from "../services/usage.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getWeekOf(date = new Date()) {
  const d   = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo    = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const reports = await db.weeklyReport.findMany({
    where:   { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take:    10,
  });

  const currentWeek  = getWeekOf();
  const hasThisWeek  = reports.some((r) => r.weekOf === currentWeek);

  // Also pull latest scan + analysis data for context display
  const latestScan   = await db.scanReport.findFirst({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } });
  const analysisCount = await db.productAnalysis.count({ where: { shop: session.shop } });
  const worstProducts = await db.productAnalysis.findMany({
    where:   { shop: session.shop },
    orderBy: { conversionScore: "asc" },
    take: 5,
  });

  return { reports, currentWeek, hasThisWeek, latestScan, analysisCount, worstProducts };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Gather data
  const [latestScan, prevScan, analyses, genCount] = await Promise.all([
    db.scanReport.findFirst({ where: { shop }, orderBy: { createdAt: "desc" } }),
    db.scanReport.findFirst({ where: { shop }, orderBy: { createdAt: "desc" }, skip: 1 }),
    db.productAnalysis.findMany({ where: { shop }, orderBy: { conversionScore: "asc" } }),
    db.generatedDescription.count({ where: { shop, applied: true } }),
  ]);

  const scoreDelta   = latestScan && prevScan ? latestScan.score - prevScan.score : null;
  const worstProds   = analyses.slice(0, 5).map((a) => `"${a.productTitle}" (Conv:${a.conversionScore}, SEO:${a.seoScore})`).join(", ");
  const avgConv      = analyses.length ? Math.round(analyses.reduce((s, a) => s + a.conversionScore, 0) / analyses.length) : 0;
  const avgSeo       = analyses.length ? Math.round(analyses.reduce((s, a) => s + a.seoScore, 0) / analyses.length) : 0;
  const needsWork    = analyses.filter((a) => a.conversionScore < 60).length;
  const topIssues    = [...new Set(analyses.slice(0, 10).map((a) => a.topIssue))].slice(0, 3);

  const prompt = `You are an e-commerce AI assistant. Write a concise weekly store health report.

Store data this week:
- Conversion score: ${latestScan?.score ?? "N/A"}/100 ${scoreDelta !== null ? `(${scoreDelta >= 0 ? "+" : ""}${scoreDelta} vs last week)` : ""}
- Products analyzed: ${analyses.length} | Avg conversion: ${avgConv}/100 | Avg SEO: ${avgSeo}/100
- Products needing attention: ${needsWork}
- Descriptions applied this week: ${genCount}
- Top 5 worst products: ${worstProds || "none yet"}
- Most common issues: ${topIssues.join("; ") || "none"}

Write a friendly, actionable weekly report with these sections (use these exact headings):
## 📈 This Week's Summary
## ⚠️ Products Needing Improvement
## 🔎 SEO Issues
## 💡 Conversion Suggestions
## 🎯 Priority Actions for Next Week

Keep it concise. Max 300 words total. Be specific and actionable.`;

  const msg = await anthropic.messages.create({
    model:      "claude-3-haiku-20240307",
    max_tokens: 600,
    messages:   [{ role: "user", content: prompt }],
  });

  const tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
  await trackUsage(shop, tokens).catch(() => {});

  const summary = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  const weekOf  = getWeekOf();

  const data = JSON.stringify({
    score:     latestScan?.score ?? null,
    scoreDelta,
    avgConv,
    avgSeo,
    needsWork,
    topIssues,
    genApplied: genCount,
    analyzed:  analyses.length,
  });

  await db.weeklyReport.upsert({
    where:  { shop_weekOf: { shop, weekOf } },
    update: { summary, data, createdAt: new Date() },
    create: { shop, weekOf, summary, data },
  });

  return { ok: true };
};

// ─── CSS ──────────────────────────────────────────────────────────────────────

const css = `
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }
  @keyframes spin   { to{transform:rotate(360deg)} }
  .wr-card {
    background:#fff; border-radius:16px; border:1px solid #e4e5e7;
    padding:24px; box-shadow:0 1px 3px rgba(0,0,0,0.06);
    animation:fadeIn 0.35s ease both;
  }
  .wr-gen-btn {
    display:inline-flex; align-items:center; gap:8px;
    padding:12px 24px; border-radius:12px; font-size:14px; font-weight:700;
    cursor:pointer; border:none;
    background:linear-gradient(135deg,#667eea,#764ba2);
    color:white; box-shadow:0 4px 14px rgba(102,126,234,0.4);
    transition:all 0.2s;
  }
  .wr-gen-btn:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 6px 20px rgba(102,126,234,0.5); }
  .wr-gen-btn:disabled{ opacity:0.65; cursor:not-allowed; }
  .wr-spinner { width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,0.4);border-top-color:white;animation:spin 0.8s linear infinite; }
  .wr-badge { display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600; }
  .wr-report-body {
    font-size:14px; line-height:1.8; color:#1a1d1f; white-space:pre-wrap;
  }
  .wr-report-body h2 {
    font-size:15px; font-weight:700; color:#1a1d1f;
    margin:16px 0 8px; padding-bottom:6px;
    border-bottom:2px solid #f1f2f3;
  }
  .wr-stat-grid {
    display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:20px;
  }
  .wr-stat {
    background:#f8f9fb; border-radius:12px; padding:16px;
    text-align:center;
  }
`;

// ─── Markdown-ish renderer ─────────────────────────────────────────────────────

function ReportBody({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="wr-report-body">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <h2 key={i} style={{ fontSize: 15, fontWeight: 700, color: "#1a1d1f", margin: "20px 0 8px", paddingBottom: 6, borderBottom: "2px solid #f1f2f3" }}>
              {line.replace("## ", "")}
            </h2>
          );
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <span style={{ flexShrink: 0, color: "#667eea", fontWeight: 700 }}>→</span>
              <span>{line.replace(/^[-•]\s*/, "")}</span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
        return <p key={i} style={{ margin: "0 0 6px" }}>{line}</p>;
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeeklyReportPage() {
  const { reports, currentWeek, hasThisWeek, latestScan, analysisCount, worstProducts } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isGenerating = fetcher.state !== "idle";
  const justGenerated = fetcher.data?.ok === true;

  // Show the most recently generated report (freshly generated takes priority)
  const displayReports = justGenerated
    ? reports // will be reloaded by React Router after action
    : reports;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1d1f", letterSpacing: "-0.5px" }}>
            📅 Weekly AI Report
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6d7175" }}>
            Claude analyzes your store data and writes a personalised weekly health report.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <fetcher.Form method="post">
            <button type="submit" className="wr-gen-btn" disabled={isGenerating}>
              {isGenerating
                ? <><div className="wr-spinner" /> Generating Report...</>
                : <><span>✨</span> {hasThisWeek ? "Regenerate This Week" : "Generate Weekly Report"}</>
              }
            </button>
          </fetcher.Form>
          <span style={{ fontSize: 12, color: "#6d7175" }}>Current week: {currentWeek}</span>
        </div>
      </div>

      {/* Store snapshot */}
      <div className="wr-stat-grid">
        <div className="wr-stat">
          <div style={{ fontSize: 28, fontWeight: 800, color: latestScan ? (latestScan.score >= 80 ? "#008060" : latestScan.score >= 60 ? "#f0a800" : "#c0392b") : "#6d7175" }}>
            {latestScan?.score ?? "—"}
          </div>
          <div style={{ fontSize: 12, color: "#6d7175", fontWeight: 600, marginTop: 4 }}>Store Score</div>
        </div>
        <div className="wr-stat">
          <div style={{ fontSize: 28, fontWeight: 800, color: "#667eea" }}>{analysisCount}</div>
          <div style={{ fontSize: 12, color: "#6d7175", fontWeight: 600, marginTop: 4 }}>Products Analyzed</div>
        </div>
        <div className="wr-stat">
          <div style={{ fontSize: 28, fontWeight: 800, color: worstProducts.length > 0 ? "#c0392b" : "#008060" }}>
            {worstProducts.filter((p) => p.conversionScore < 60).length}
          </div>
          <div style={{ fontSize: 12, color: "#6d7175", fontWeight: 600, marginTop: 4 }}>Need Attention</div>
        </div>
      </div>

      {/* Worst products preview */}
      {worstProducts.length > 0 && (
        <div className="wr-card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1d1f", marginBottom: 12 }}>
            🚨 Products Most Needing Improvement
          </div>
          {worstProducts.map((p) => (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 0", borderBottom: "1px solid #f1f2f3", gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1d1f" }}>{p.productTitle}</div>
                <div style={{ fontSize: 12, color: "#c0392b", marginTop: 2 }}>⚠️ {p.topIssue}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <span className="wr-badge" style={{ background: p.conversionScore < 60 ? "#fff0f0" : "#f0faf5", color: p.conversionScore < 60 ? "#c0392b" : "#008060" }}>
                  Conv: {p.conversionScore}
                </span>
                <span className="wr-badge" style={{ background: p.seoScore < 60 ? "#fff0f0" : "#f0faf5", color: p.seoScore < 60 ? "#c0392b" : "#008060" }}>
                  SEO: {p.seoScore}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Report list */}
      {displayReports.length === 0 && !isGenerating ? (
        <div className="wr-card" style={{ textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1d1f", marginBottom: 8 }}>No reports yet</div>
          <div style={{ fontSize: 14, color: "#6d7175", marginBottom: 24, lineHeight: 1.7 }}>
            Generate your first weekly report to get a personalised AI summary of your store's health, top issues, and priority actions.
          </div>
          <fetcher.Form method="post">
            <button type="submit" className="wr-gen-btn">
              <span>🚀</span> Generate First Report
            </button>
          </fetcher.Form>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {displayReports.map((report, i) => {
            let parsed: any = {};
            try { parsed = JSON.parse(report.data); } catch { /* ignore */ }

            return (
              <div key={report.id} className="wr-card" style={{ animationDelay: `${i * 0.05}s` }}>
                {/* Report header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#1a1d1f" }}>
                    {report.weekOf}
                  </span>
                  {i === 0 && (
                    <span className="wr-badge" style={{ background: "#f0faf5", color: "#008060" }}>Latest</span>
                  )}
                  <span style={{ fontSize: 12, color: "#6d7175", marginLeft: "auto" }}>
                    {new Date(report.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>

                {/* Mini stats */}
                {parsed.score !== undefined && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                    <span className="wr-badge" style={{ background: "#f8f9fb", color: "#1a1d1f" }}>
                      Score: <strong>{parsed.score}</strong>
                      {parsed.scoreDelta !== null && parsed.scoreDelta !== undefined && (
                        <strong style={{ color: parsed.scoreDelta >= 0 ? "#008060" : "#c0392b", marginLeft: 4 }}>
                          {parsed.scoreDelta >= 0 ? `▲+${parsed.scoreDelta}` : `▼${parsed.scoreDelta}`}
                        </strong>
                      )}
                    </span>
                    {parsed.avgConv !== undefined && (
                      <span className="wr-badge" style={{ background: "#f8f9fb", color: "#1a1d1f" }}>
                        Avg Conv: <strong>{parsed.avgConv}</strong>
                      </span>
                    )}
                    {parsed.avgSeo !== undefined && (
                      <span className="wr-badge" style={{ background: "#f8f9fb", color: "#1a1d1f" }}>
                        Avg SEO: <strong>{parsed.avgSeo}</strong>
                      </span>
                    )}
                    {parsed.needsWork !== undefined && (
                      <span className="wr-badge" style={{ background: parsed.needsWork > 0 ? "#fff0f0" : "#f0faf5", color: parsed.needsWork > 0 ? "#c0392b" : "#008060" }}>
                        ⚠️ {parsed.needsWork} need attention
                      </span>
                    )}
                  </div>
                )}

                {/* Report body */}
                <div style={{ background: "#f8f9fb", borderRadius: 12, padding: "16px 20px", borderLeft: "4px solid #667eea" }}>
                  <ReportBody text={report.summary} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
