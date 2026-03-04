import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Loader: fetch products from Shopify ──────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  const response = await admin.graphql(
    `#graphql
    query GetProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id title status totalInventory
            descriptionHtml
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
            }
            images(first: 1) {
              edges { node { url altText } }
            }
          }
        }
      }
    }`,
    { variables: { first: 20, after: cursor ?? null } }
  );

  const data = await response.json();
  const { products } = data.data;

  return {
    products: products.edges.map(({ node }: any) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      inventory: node.totalInventory,
      price: `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}`,
      description: node.descriptionHtml.replace(/<[^>]+>/g, "").trim().slice(0, 200),
      image: node.images.edges[0]?.node ?? null,
      hasDescription: node.descriptionHtml.replace(/<[^>]+>/g, "").trim().length > 20,
      hasImages: node.images.edges.length > 0,
    })),
    pageInfo: products.pageInfo,
  };
};

// ─── Action: AI analysis for a single product ─────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const title       = formData.get("title") as string;
  const description = formData.get("description") as string;
  const price       = formData.get("price") as string;
  const productId   = formData.get("productId") as string;

  const prompt = `You are a Shopify conversion rate expert. Analyze this product and give specific, actionable advice.

Product: "${title}"
Price: ${price}
Description: ${description || "No description provided."}

Reply ONLY with this exact JSON (no markdown, no extra text):
{
  "conversionTips": ["tip 1", "tip 2", "tip 3"],
  "headlineSuggestion": "better title here",
  "descriptionImprovement": "improved 2-sentence description here",
  "pricingSuggestion": "one-sentence pricing advice"
}`;

  const msg = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 450,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";

  try {
    const result = JSON.parse(text);
    return { productId, ...result };
  } catch {
    return {
      productId,
      conversionTips: ["Couldn't parse AI response — please try again."],
      headlineSuggestion: title,
      descriptionImprovement: "",
      pricingSuggestion: "",
    };
  }
};

// ─── CSS ──────────────────────────────────────────────────────────────────────

const css = `
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }
  @keyframes spin { to{transform:rotate(360deg)} }
  .p-card {
    background:#fff; border-radius:16px; border:1px solid #e4e5e7;
    padding:20px; box-shadow:0 1px 3px rgba(0,0,0,0.06);
    animation:fadeIn 0.35s ease both;
    transition:box-shadow 0.2s;
  }
  .p-card:hover { box-shadow:0 4px 14px rgba(0,0,0,0.09); }
  .p-badge {
    display:inline-flex;align-items:center;gap:4px;
    padding:3px 9px;border-radius:20px;font-size:12px;font-weight:600;
  }
  .p-analyze-btn {
    display:inline-flex;align-items:center;gap:6px;
    padding:8px 18px;border-radius:10px;font-size:13px;font-weight:700;
    cursor:pointer;border:none;
    background:linear-gradient(135deg,#667eea,#764ba2);
    color:white;box-shadow:0 3px 10px rgba(102,126,234,0.35);
    transition:all 0.2s;
  }
  .p-analyze-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 15px rgba(102,126,234,0.45);}
  .p-analyze-btn:disabled{opacity:0.6;cursor:not-allowed;}
  .p-tip {
    display:flex;align-items:flex-start;gap:10px;
    padding:10px 14px;background:#f8f9ff;border-radius:10px;
    border-left:3px solid #667eea;font-size:13px;line-height:1.6;color:#1a1d1f;
  }
  .p-result-grid {
    display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;
  }
  .p-result-box {
    background:#f8f9ff;border-radius:12px;padding:14px;
  }
  .p-spinner {
    width:16px;height:16px;border-radius:50%;
    border:2px solid rgba(255,255,255,0.4);border-top-color:white;
    animation:spin 0.8s linear infinite;
  }
`;

// ─── Product Card ──────────────────────────────────────────────────────────────

function ProductCard({
  product,
  analysisResult,
  isAnalyzing,
}: {
  product: any;
  analysisResult: any;
  isAnalyzing: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data?.productId === product.id ? fetcher.data : analysisResult;
  const analyzing = fetcher.state !== "idle";

  const issues = [];
  if (product.inventory === 0 && product.status === "ACTIVE") issues.push({ label: "Out of Stock", color: "#c0392b", bg: "#fff0f0", icon: "❌" });
  if (product.inventory > 0 && product.inventory < 5) issues.push({ label: "Low Stock", color: "#b97d00", bg: "#fff8ed", icon: "⚠️" });
  if (product.status === "DRAFT") issues.push({ label: "Draft", color: "#5c6ac4", bg: "#f0f1ff", icon: "📝" });
  if (!product.hasDescription) issues.push({ label: "No Description", color: "#6d7175", bg: "#f4f6f8", icon: "📄" });
  if (!product.hasImages) issues.push({ label: "No Images", color: "#6d7175", bg: "#f4f6f8", icon: "🖼️" });

  return (
    <div className="p-card">
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

        {/* Thumbnail */}
        <div style={{
          width: 72, height: 72, borderRadius: 12, flexShrink: 0,
          background: "#f4f6f8", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid #e4e5e7",
        }}>
          {product.image
            ? <img src={product.image.url} alt={product.image.altText ?? product.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: 28 }}>📦</span>
          }
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1d1f", marginBottom: 4 }}>{product.title}</div>
              <div style={{ fontSize: 13, color: "#6d7175", marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: "#1a1d1f" }}>{product.price}</span>
                &nbsp;·&nbsp;
                <span>Stock: <strong>{product.inventory}</strong></span>
              </div>
            </div>

            {/* Analyze button */}
            <fetcher.Form method="post">
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="title" value={product.title} />
              <input type="hidden" name="description" value={product.description} />
              <input type="hidden" name="price" value={product.price} />
              <button type="submit" className="p-analyze-btn" disabled={analyzing}>
                {analyzing
                  ? <><div className="p-spinner" /> Analyzing...</>
                  : <><span>🤖</span> {result ? "Re-analyze" : "Analyze"}</>
                }
              </button>
            </fetcher.Form>
          </div>

          {/* Issue badges */}
          {issues.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {issues.map((issue) => (
                <span key={issue.label} className="p-badge" style={{ background: issue.bg, color: issue.color }}>
                  {issue.icon} {issue.label}
                </span>
              ))}
            </div>
          )}

          {issues.length === 0 && (
            <span className="p-badge" style={{ background: "#f0faf5", color: "#008060" }}>✅ No issues</span>
          )}
        </div>
      </div>

      {/* AI Results */}
      {result && (
        <div style={{ marginTop: 20, borderTop: "1px solid #f1f2f3", paddingTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#667eea", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 24, height: 24, borderRadius: 6,
              background: "linear-gradient(135deg,#667eea,#764ba2)", fontSize: 12,
            }}>🤖</span>
            AI Conversion Analysis
          </div>

          {/* Conversion tips */}
          {result.conversionTips?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>
                Conversion Tips
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {result.conversionTips.map((tip: string, i: number) => (
                  <div key={i} className="p-tip">
                    <span style={{ flexShrink: 0, fontWeight: 700, color: "#667eea" }}>0{i + 1}</span>
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="p-result-grid">
            {/* Headline */}
            {result.headlineSuggestion && (
              <div className="p-result-box">
                <div style={{ fontSize: 11, fontWeight: 700, color: "#667eea", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6 }}>
                  ✏️ Better Title
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1d1f", lineHeight: 1.5 }}>
                  "{result.headlineSuggestion}"
                </div>
              </div>
            )}

            {/* Pricing */}
            {result.pricingSuggestion && (
              <div className="p-result-box">
                <div style={{ fontSize: 11, fontWeight: 700, color: "#667eea", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6 }}>
                  💰 Pricing Advice
                </div>
                <div style={{ fontSize: 13, color: "#1a1d1f", lineHeight: 1.5 }}>
                  {result.pricingSuggestion}
                </div>
              </div>
            )}

            {/* Description */}
            {result.descriptionImprovement && (
              <div className="p-result-box" style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#667eea", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6 }}>
                  📝 Improved Description
                </div>
                <div style={{ fontSize: 13, color: "#1a1d1f", lineHeight: 1.7 }}>
                  {result.descriptionImprovement}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { products, pageInfo } = useLoaderData<typeof loader>();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1d1f", letterSpacing: "-0.5px" }}>
          🤖 AI Product Analysis
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6d7175" }}>
          Click "Analyze" on any product to get Claude AI conversion suggestions — headline, description, pricing & tips.
        </p>
      </div>

      {/* Info banner */}
      <div style={{
        background: "linear-gradient(135deg,#f8f9ff,#f0f1ff)",
        border: "1px solid #d0d5ff", borderRadius: 14,
        padding: "14px 18px", marginBottom: 24,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{ fontSize: 24 }}>💡</span>
        <div style={{ fontSize: 13, color: "#1a1d1f", lineHeight: 1.6 }}>
          <strong>Powered by Claude AI.</strong> Each product analysis generates a better title, improved description, pricing advice, and 3 conversion tips. Results appear inline — no page reload needed.
        </div>
      </div>

      {/* Product cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {products.map((product: any, i: number) => (
          <div key={product.id} style={{ animationDelay: `${i * 0.04}s` }}>
            <ProductCard product={product} analysisResult={null} isAnalyzing={false} />
          </div>
        ))}
      </div>

      {/* Pagination */}
      {pageInfo.hasNextPage && (
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <a
            href={`?cursor=${pageInfo.endCursor}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "12px 24px", borderRadius: 12, fontSize: 14, fontWeight: 700,
              background: "#f4f6f8", color: "#1a1d1f", textDecoration: "none",
              border: "1px solid #e4e5e7",
            }}
          >
            Load More Products →
          </a>
        </div>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
