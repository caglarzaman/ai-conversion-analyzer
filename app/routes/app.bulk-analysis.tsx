import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { runBulkAnalysis, autoFixProduct } from "../services/bulk-analyzer.server";
import db from "../db.server";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const results = await db.productAnalysis.findMany({
    where:   { shop: session.shop },
    orderBy: { conversionScore: "asc" }, // worst first
  });

  const lastRun = results[0]?.analyzedAt ?? null;
  const avgConv = results.length
    ? Math.round(results.reduce((s, r) => s + r.conversionScore, 0) / results.length)
    : null;
  const avgSeo = results.length
    ? Math.round(results.reduce((s, r) => s + r.seoScore, 0) / results.length)
    : null;

  return { results, lastRun, avgConv, avgSeo, total: results.length };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent   = formData.get("intent") as string;

  if (intent === "analyze") {
    try {
      await runBulkAnalysis(admin, session.shop);
      return { ok: true, intent: "analyze" };
    } catch (err) {
      console.error("Bulk analysis failed:", err);
      return { ok: false, intent: "analyze", error: "Analysis failed. Please try again." };
    }
  }

  if (intent === "autofix") {
    const productId    = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;
    const description  = formData.get("description") as string;
    const price        = formData.get("price") as string;

    const result = await autoFixProduct(admin, session.shop, productId, productTitle, description, price);
    return { ok: result.ok, intent: "autofix", productId, error: result.error };
  }

  return { ok: false, intent: "unknown" };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 80) return "#00b374";
  if (score >= 60) return "#f0a800";
  if (score >= 40) return "#e07c00";
  return "#e32b2b";
}

function scoreBg(score: number) {
  if (score >= 80) return "#f0faf5";
  if (score >= 60) return "#fff8ed";
  if (score >= 40) return "#fff3e0";
  return "#fff0f0";
}

function formatDate(d: string | Date | null) {
  if (!d) return "Never";
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const css = `
  @keyframes fadeIn { from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)} }
  @keyframes spin   { to{transform:rotate(360deg)} }
  @keyframes progress { from{width:0} to{width:100%} }

  .ba-card {
    background:#fff; border-radius:16px; border:1px solid #e4e5e7;
    padding:20px; box-shadow:0 1px 3px rgba(0,0,0,0.06);
    animation:fadeIn 0.3s ease both;
  }
  .ba-analyze-btn {
    display:inline-flex; align-items:center; gap:8px;
    padding:13px 28px; border-radius:12px; font-size:15px; font-weight:700;
    cursor:pointer; border:none;
    background:linear-gradient(135deg,#667eea,#764ba2);
    color:white; box-shadow:0 4px 14px rgba(102,126,234,0.4);
    transition:all 0.2s;
  }
  .ba-analyze-btn:hover:not(:disabled){ transform:translateY(-2px); box-shadow:0 6px 20px rgba(102,126,234,0.5); }
  .ba-analyze-btn:disabled { opacity:0.65; cursor:not-allowed; transform:none; }
  .ba-fix-btn {
    display:inline-flex; align-items:center; gap:5px;
    padding:7px 14px; border-radius:9px; font-size:12px; font-weight:700;
    cursor:pointer; border:none;
    background:linear-gradient(135deg,#00b374,#008060);
    color:white; box-shadow:0 2px 8px rgba(0,179,116,0.3);
    transition:all 0.2s; white-space:nowrap;
  }
  .ba-fix-btn:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,179,116,0.4); }
  .ba-fix-btn:disabled { opacity:0.6; cursor:not-allowed; transform:none; }
  .ba-spinner { width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,0.4);border-top-color:white;animation:spin 0.8s linear infinite; }
  .ba-badge { display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700; }
  .ba-score-pill {
    display:inline-flex; flex-direction:column; align-items:center;
    width:52px; padding:6px 4px; border-radius:10px;
    font-size:16px; font-weight:800; line-height:1;
  }
  .ba-table-row {
    display:grid;
    grid-template-columns: 2fr 90px 90px 1fr 160px;
    gap:12px; padding:14px 16px; align-items:center;
    border-bottom:1px solid #f1f2f3; font-size:13px;
    transition:background 0.1s;
  }
  .ba-table-row:hover { background:#fafbfb; }
  .ba-table-row:last-child { border-bottom:none; }
  .ba-progress { height:6px; border-radius:99px; background:#e4e5e7; overflow:hidden; margin-top:4px; }
  .ba-progress-fill { height:100%; border-radius:99px; transition:width 0.6s ease; }
`;

// ─── Auto Fix Row ─────────────────────────────────────────────────────────────

function AutoFixBtn({ row }: { row: any }) {
  const fetcher = useFetcher<typeof action>();
  const fixing  = fetcher.state !== "idle";
  const done    = fetcher.data?.ok === true && fetcher.data?.intent === "autofix";
  const failed  = fetcher.data?.ok === false && fetcher.data?.intent === "autofix";

  if (row.applied || done) {
    return <span className="ba-badge" style={{ background: "#f0faf5", color: "#008060" }}>✅ Fixed</span>;
  }

  return (
    <div>
      <fetcher.Form method="post">
        <input type="hidden" name="intent"        value="autofix" />
        <input type="hidden" name="productId"     value={row.productId} />
        <input type="hidden" name="productTitle"  value={row.productTitle} />
        <input type="hidden" name="description"   value="" />
        <input type="hidden" name="price"         value="" />
        <button type="submit" className="ba-fix-btn" disabled={fixing}>
          {fixing ? <><div className="ba-spinner" /> Fixing...</> : <><span>⚡</span> Auto Fix</>}
        </button>
      </fetcher.Form>
      {failed && (
        <div style={{ fontSize: 11, color: "#c0392b", marginTop: 4 }}>Failed. Retry.</div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BulkAnalysisPage() {
  const { results, lastRun, avgConv, avgSeo, total } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isAnalyzing = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "analyze";
  const analyzeFailed = fetcher.data?.ok === false && fetcher.data?.intent === "analyze";

  const needsAttention = results.filter((r) => r.conversionScore < 60).length;
  const applied        = results.filter((r) => r.applied).length;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 20px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1d1f", letterSpacing: "-0.5px" }}>
            📊 Bulk Product Analysis
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6d7175" }}>
            AI scores every product for conversion rate and SEO — then one-click fixes the worst offenders.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="analyze" />
            <button type="submit" className="ba-analyze-btn" disabled={isAnalyzing}>
              {isAnalyzing
                ? <><div className="ba-spinner" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "white" }} /> Analyzing Products...</>
                : <><span style={{ fontSize: 18 }}>🔍</span> {total > 0 ? "Re-Analyze All" : "Analyze All Products"}</>
              }
            </button>
          </fetcher.Form>
          {lastRun && (
            <span style={{ fontSize: 12, color: "#6d7175" }}>Last run: {formatDate(lastRun)}</span>
          )}
        </div>
      </div>

      {/* Analysis progress bar */}
      {isAnalyzing && (
        <div style={{ marginBottom: 20, padding: "16px 20px", background: "#f8f9ff", borderRadius: 14, border: "1px solid #d0d5ff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div className="ba-spinner" style={{ borderColor: "#d0d5ff", borderTopColor: "#667eea" }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#667eea" }}>
              Analyzing all products in batches of 10 · This takes about 30 seconds...
            </span>
          </div>
          <div className="ba-progress">
            <div className="ba-progress-fill" style={{ width: "100%", background: "linear-gradient(90deg,#667eea,#764ba2)", animation: "progress 30s linear" }} />
          </div>
        </div>
      )}

      {analyzeFailed && (
        <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fff0f0", borderRadius: 12, color: "#c0392b", fontSize: 14 }}>
          ❌ {(fetcher.data as any)?.error ?? "Analysis failed. Please try again."}
        </div>
      )}

      {/* Summary cards */}
      {total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
          <div className="ba-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#667eea" }}>{total}</div>
            <div style={{ fontSize: 12, color: "#6d7175", fontWeight: 600, marginTop: 4 }}>Products Analyzed</div>
          </div>
          <div className="ba-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: scoreColor(avgConv ?? 0) }}>{avgConv ?? "—"}</div>
            <div style={{ fontSize: 12, color: "#6d7175", fontWeight: 600, marginTop: 4 }}>Avg Conversion Score</div>
          </div>
          <div className="ba-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: scoreColor(avgSeo ?? 0) }}>{avgSeo ?? "—"}</div>
            <div style={{ fontSize: 12, color: "#6d7175", fontWeight: 600, marginTop: 4 }}>Avg SEO Score</div>
          </div>
          <div className="ba-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: needsAttention > 0 ? "#c0392b" : "#008060" }}>{needsAttention}</div>
            <div style={{ fontSize: 12, color: "#6d7175", fontWeight: 600, marginTop: 4 }}>Needs Attention</div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {total === 0 && !isAnalyzing && (
        <div className="ba-card" style={{ textAlign: "center", padding: "64px 24px" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📊</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1d1f", marginBottom: 8 }}>
            No analysis yet
          </div>
          <div style={{ fontSize: 14, color: "#6d7175", maxWidth: 440, margin: "0 auto 24px", lineHeight: 1.7 }}>
            Click "Analyze All Products" to score every product in your store for conversion rate and SEO.
            Each product gets a score and a one-click Auto Fix.
          </div>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="analyze" />
            <button type="submit" className="ba-analyze-btn">
              <span style={{ fontSize: 18 }}>🚀</span> Start Analysis
            </button>
          </fetcher.Form>
        </div>
      )}

      {/* Results table */}
      {total > 0 && (
        <div className="ba-card" style={{ padding: 0, overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 90px 90px 1fr 160px",
            gap: 12, padding: "12px 16px",
            fontSize: 11, fontWeight: 700, color: "#6d7175",
            textTransform: "uppercase", letterSpacing: "0.7px",
            background: "#f8f9fb", borderBottom: "2px solid #e4e5e7",
          }}>
            <span>Product</span>
            <span style={{ textAlign: "center" }}>Conv. Score</span>
            <span style={{ textAlign: "center" }}>SEO Score</span>
            <span>Top Issue → Quick Fix</span>
            <span style={{ textAlign: "center" }}>Action</span>
          </div>

          {results.map((row, i) => (
            <div key={row.id} className="ba-table-row" style={{ animationDelay: `${i * 0.02}s` }}>
              {/* Product name */}
              <div>
                <div style={{ fontWeight: 600, color: "#1a1d1f", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.productTitle}
                </div>
                <div style={{ fontSize: 11, color: "#6d7175", marginTop: 2 }}>
                  {row.applied && <span className="ba-badge" style={{ background: "#f0faf5", color: "#008060" }}>✅ Fixed</span>}
                </div>
              </div>

              {/* Conv score */}
              <div style={{ textAlign: "center" }}>
                <div className="ba-score-pill" style={{ background: scoreBg(row.conversionScore), color: scoreColor(row.conversionScore), margin: "0 auto" }}>
                  {row.conversionScore}
                  <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.75, marginTop: 1 }}>/100</span>
                </div>
                <div className="ba-progress" style={{ marginTop: 6 }}>
                  <div className="ba-progress-fill" style={{ width: `${row.conversionScore}%`, background: scoreColor(row.conversionScore) }} />
                </div>
              </div>

              {/* SEO score */}
              <div style={{ textAlign: "center" }}>
                <div className="ba-score-pill" style={{ background: scoreBg(row.seoScore), color: scoreColor(row.seoScore), margin: "0 auto" }}>
                  {row.seoScore}
                  <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.75, marginTop: 1 }}>/100</span>
                </div>
                <div className="ba-progress" style={{ marginTop: 6 }}>
                  <div className="ba-progress-fill" style={{ width: `${row.seoScore}%`, background: scoreColor(row.seoScore) }} />
                </div>
              </div>

              {/* Issue + Fix */}
              <div>
                <div style={{ fontSize: 12, color: "#c0392b", fontWeight: 600, marginBottom: 3 }}>
                  ⚠️ {row.topIssue}
                </div>
                <div style={{ fontSize: 12, color: "#008060" }}>
                  💡 {row.quickFix}
                </div>
              </div>

              {/* Auto Fix button */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <AutoFixBtn row={row} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Applied count */}
      {applied > 0 && (
        <div style={{ marginTop: 16, textAlign: "center", fontSize: 13, color: "#6d7175" }}>
          ✅ {applied} product{applied !== 1 ? "s" : ""} auto-fixed this session
        </div>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
