import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { detectPlan } from "../services/plan.server";
import { trackUsage } from "../services/usage.server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeoResult {
  seo_score: number;
  meta_title: string;
  meta_description: string;
  keywords: string[];
  alt_text_suggestions: string[];
  issues: string[];
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);

  const plan = await detectPlan(billing);
  if (plan === "free") {
    return { plan, products: [] as { id: string; title: string }[] };
  }

  const res = await admin.graphql(`#graphql
    query { products(first: 50) { edges { node { id title } } } }
  `);
  const data = await res.json();
  const products: { id: string; title: string }[] =
    data.data.products.edges.map((e: any) => ({ id: e.node.id, title: e.node.title }));

  return { plan, products };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);

  const plan = await detectPlan(billing);
  if (plan === "free") return { error: "Pro plan required" };

  const formData  = await request.formData();
  const productId = formData.get("productId") as string;
  if (!productId) return { error: "No product selected" };

  // Fetch product details from Shopify
  const res = await admin.graphql(
    `#graphql
    query GetProductSeo($id: ID!) {
      product(id: $id) {
        title
        descriptionHtml
        images(first: 5) { edges { node { url } } }
      }
    }`,
    { variables: { id: productId } }
  );
  const data = await res.json();
  const p    = data.data?.product;
  if (!p) return { error: "Product not found" };

  const title       = p.title as string;
  const description = (p.descriptionHtml as string).replace(/<[^>]+>/g, "").trim();
  const imageCount  = (p.images.edges as any[]).length;

  const prompt = `You are an SEO expert for Shopify e-commerce. Analyze this product for SEO.

Title (${title.length} chars): "${title}"
Description (${description.length} chars): ${description.slice(0, 500) || "MISSING"}
Images: ${imageCount}

Return ONLY valid JSON (no markdown, no explanation):
{
  "seo_score": 72,
  "meta_title": "SEO-optimized product title under 60 chars",
  "meta_description": "Compelling meta description 150-160 chars with primary keyword naturally included",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "alt_text_suggestions": ["descriptive alt text for main product image"],
  "issues": ["Specific actionable issue 1", "Specific actionable issue 2"]
}

Score rubric (each worth 20 pts):
- Title is 40–60 chars with primary keyword
- Description is over 150 chars
- Primary keyword appears in title
- At least 1 image present
- Title avoids generic words like "product", "item"`;

  const msg = await anthropic.messages.create({
    model:      "claude-3-haiku-20240307",
    max_tokens: 500,
    messages:   [{ role: "user", content: prompt }],
  });

  const tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
  await trackUsage(session.shop, tokens).catch(() => {});

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
  try {
    const match  = text.match(/\{[\s\S]*\}/);
    const result = match ? (JSON.parse(match[0]) as SeoResult) : null;
    return { result, productId, productTitle: title };
  } catch {
    return { error: "Failed to parse AI response" };
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 80) return "#008060";
  if (score >= 60) return "#b97d00";
  if (score >= 40) return "#e07c00";
  return "#c0392b";
}

function scoreLabel(score: number) {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Needs Work";
  return "Poor";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SeoOptimizerPage() {
  const { plan, products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isAnalyzing = fetcher.state !== "idle";
  const result      = fetcher.data?.result as SeoResult | undefined;
  const error       = fetcher.data?.error;
  const productTitle = fetcher.data?.productTitle;

  const css = `
    @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
    @keyframes spin { to { transform:rotate(360deg); } }
    .seo-card { background:#fff; border:1px solid #e4e5e7; border-radius:16px; padding:24px; animation:fadeIn 0.35s ease; }
    .seo-chip { display:inline-flex; align-items:center; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600; }
    .seo-spinner { width:20px; height:20px; border:3px solid #e4e5e7; border-top-color:#667eea; border-radius:50%; animation:spin 0.8s linear infinite; }
    .seo-score-bar-bg { height:8px; background:#f1f2f3; border-radius:99px; overflow:hidden; margin-top:6px; }
  `;

  if (plan === "free") {
    return (
      <div style={{ maxWidth: "700px", margin: "60px auto", padding: "0 20px", textAlign: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div style={{ fontSize: "60px", marginBottom: "20px" }}>🔒</div>
        <h1 style={{ margin: "0 0 12px", fontSize: "24px", fontWeight: "800", color: "#1a1d1f" }}>
          SEO Optimizer requires Pro
        </h1>
        <p style={{ fontSize: "15px", color: "#6d7175", marginBottom: "28px", lineHeight: 1.7 }}>
          Upgrade to the Pro plan to unlock AI-powered SEO analysis — meta titles, meta descriptions, keyword suggestions and more.
        </p>
        <a href="/app/billing" style={{
          display: "inline-flex", alignItems: "center", gap: "8px",
          padding: "14px 28px", borderRadius: "12px",
          background: "linear-gradient(135deg, #667eea, #764ba2)",
          color: "white", fontSize: "15px", fontWeight: "700",
          textDecoration: "none",
        }}>
          ⬆️ Upgrade to Pro — $19/mo
        </a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "28px 20px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: "800", color: "#1a1d1f" }}>
          📈 SEO Optimizer
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#6d7175" }}>
          Select a product to get AI-powered SEO recommendations — meta title, meta description, keywords and more.
        </p>
      </div>

      {/* Product selector */}
      <div className="seo-card" style={{ marginBottom: "20px" }}>
        <fetcher.Form method="post">
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "240px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#6d7175", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Choose Product
              </label>
              <select
                name="productId"
                required
                style={{
                  width: "100%", padding: "10px 14px",
                  border: "1px solid #d4d5d8", borderRadius: "10px",
                  fontSize: "14px", color: "#1a1d1f",
                  background: "#fff", outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">— Select a product —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={isAnalyzing}
              style={{
                padding: "10px 24px", border: "none", borderRadius: "10px",
                background: "linear-gradient(135deg, #667eea, #764ba2)",
                color: "white", fontSize: "14px", fontWeight: "700",
                cursor: isAnalyzing ? "not-allowed" : "pointer",
                opacity: isAnalyzing ? 0.75 : 1,
                display: "flex", alignItems: "center", gap: "8px",
                transition: "opacity 0.15s",
                flexShrink: 0,
              }}
            >
              {isAnalyzing ? (
                <><div className="seo-spinner" /> Analyzing...</>
              ) : (
                <><span>📈</span> Analyze SEO</>
              )}
            </button>
          </div>
        </fetcher.Form>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "14px 18px", background: "#fff0f0", border: "1px solid #fcc", borderRadius: "12px", fontSize: "14px", color: "#c0392b", marginBottom: "20px" }}>
          ❌ {error}
        </div>
      )}

      {/* Results */}
      {result && !isAnalyzing && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Score banner */}
          <div className="seo-card" style={{
            background: `linear-gradient(135deg, ${scoreColor(result.seo_score)}15, ${scoreColor(result.seo_score)}08)`,
            border: `1.5px solid ${scoreColor(result.seo_score)}40`,
            display: "flex", alignItems: "center", gap: "24px",
          }}>
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ fontSize: "56px", fontWeight: "800", color: scoreColor(result.seo_score), lineHeight: 1 }}>
                {result.seo_score}
              </div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>/ 100</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "20px", fontWeight: "800", color: scoreColor(result.seo_score), marginBottom: "4px" }}>
                {scoreLabel(result.seo_score)} SEO Score
              </div>
              <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "8px" }}>
                Analysis for: <strong style={{ color: "#1a1d1f" }}>{productTitle}</strong>
              </div>
              <div className="seo-score-bar-bg">
                <div style={{
                  height: "100%", borderRadius: "99px",
                  width: `${result.seo_score}%`,
                  background: scoreColor(result.seo_score),
                  transition: "width 1s ease",
                }} />
              </div>
            </div>
          </div>

          {/* Issues */}
          {result.issues?.length > 0 && (
            <div className="seo-card">
              <h3 style={{ margin: "0 0 14px", fontSize: "15px", fontWeight: "700", color: "#1a1d1f" }}>
                ⚠️ Issues to Fix
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {result.issues.map((issue, i) => (
                  <div key={i} style={{
                    display: "flex", gap: "10px", padding: "10px 14px",
                    background: "#fff8ed", borderRadius: "10px",
                    borderLeft: "3px solid #b97d00",
                    fontSize: "14px", color: "#1a1d1f", lineHeight: 1.5,
                  }}>
                    <span style={{ flexShrink: 0 }}>⚠️</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta suggestions */}
          <div className="seo-card">
            <h3 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: "700", color: "#1a1d1f" }}>
              🏷️ Suggested Meta Tags
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <CopyField label="Meta Title" value={result.meta_title} ideal="50–60 chars" />
              <CopyField label="Meta Description" value={result.meta_description} ideal="150–160 chars" multiline />
            </div>
          </div>

          {/* Keywords */}
          <div className="seo-card">
            <h3 style={{ margin: "0 0 14px", fontSize: "15px", fontWeight: "700", color: "#1a1d1f" }}>
              🔑 Target Keywords
            </h3>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {result.keywords.map((kw, i) => (
                <span key={i} className="seo-chip" style={{ background: "#f0f1ff", color: "#667eea" }}>
                  {kw}
                </span>
              ))}
            </div>
          </div>

          {/* Alt text */}
          {result.alt_text_suggestions?.length > 0 && (
            <div className="seo-card">
              <h3 style={{ margin: "0 0 14px", fontSize: "15px", fontWeight: "700", color: "#1a1d1f" }}>
                🖼️ Image Alt Text Suggestions
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {result.alt_text_suggestions.map((alt, i) => (
                  <div key={i} style={{
                    padding: "10px 14px", background: "#f6faf8",
                    borderRadius: "10px", borderLeft: "3px solid #008060",
                    fontSize: "13px", color: "#1a1d1f",
                  }}>
                    <span style={{ color: "#6d7175", marginRight: "6px" }}>Image {i + 1}:</span>
                    {alt}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* Empty state */}
      {!result && !isAnalyzing && !error && (
        <div style={{
          textAlign: "center", padding: "60px 20px",
          border: "2px dashed #e4e5e7", borderRadius: "16px",
          color: "#6d7175",
        }}>
          <div style={{ fontSize: "48px", marginBottom: "14px" }}>📈</div>
          <div style={{ fontWeight: "700", fontSize: "16px", color: "#1a1d1f", marginBottom: "6px" }}>
            Select a product to analyze
          </div>
          <div style={{ fontSize: "14px" }}>
            Get AI suggestions for meta title, description, keywords and image alt text.
          </div>
        </div>
      )}

    </div>
  );
}

// ─── CopyField ────────────────────────────────────────────────────────────────

function CopyField({ label, value, ideal, multiline = false }: {
  label: string; value: string; ideal: string; multiline?: boolean;
}) {
  const len = value.length;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontSize: "12px", fontWeight: "700", color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {label}
        </span>
        <span style={{ fontSize: "12px", color: len > 160 ? "#c0392b" : "#6d7175" }}>
          {len} chars · ideal {ideal}
        </span>
      </div>
      {multiline ? (
        <textarea
          readOnly
          value={value}
          rows={3}
          style={{
            width: "100%", padding: "10px 14px",
            border: "1px solid #d4d5d8", borderRadius: "10px",
            fontSize: "14px", color: "#1a1d1f",
            background: "#f8f9fb", resize: "none", boxSizing: "border-box",
            fontFamily: "inherit", lineHeight: 1.5,
          }}
        />
      ) : (
        <input
          readOnly
          value={value}
          style={{
            width: "100%", padding: "10px 14px",
            border: "1px solid #d4d5d8", borderRadius: "10px",
            fontSize: "14px", color: "#1a1d1f",
            background: "#f8f9fb", boxSizing: "border-box",
          }}
        />
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
