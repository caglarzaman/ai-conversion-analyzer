import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Fetch up to 100 products with enough detail for health checks
  const res = await admin.graphql(`#graphql
    query StoreHealth {
      products(first: 100) {
        edges {
          node {
            id
            title
            status
            totalInventory
            descriptionHtml
            images(first: 1) { edges { node { url } } }
            variants(first: 1) { edges { node { price } } }
          }
        }
      }
    }
  `);
  const data = await res.json();
  const raw: any[] = data.data.products.edges.map((e: any) => e.node);

  const total = raw.length;
  if (total === 0) {
    return {
      total: 0,
      dimensions: [],
      overallScore: 0,
      worstProducts: [],
    };
  }

  // ── Dimension checks ──────────────────────────────────────────────────────

  const active       = raw.filter((p) => p.status === "ACTIVE");
  const activeCount  = active.length;

  // 1. Inventory Health — active products with inventory > 0
  const withStock     = active.filter((p) => p.totalInventory > 0).length;
  const inventoryScore = activeCount > 0 ? Math.round((withStock / activeCount) * 100) : 100;

  // 2. Content Quality — products with description > 80 chars
  const withDesc      = raw.filter((p) => {
    const text = (p.descriptionHtml as string).replace(/<[^>]+>/g, "").trim();
    return text.length > 80;
  }).length;
  const contentScore  = Math.round((withDesc / total) * 100);

  // 3. Visual Quality — products with at least 1 image
  const withImages    = raw.filter((p) => (p.images.edges as any[]).length > 0).length;
  const visualScore   = Math.round((withImages / total) * 100);

  // 4. Listing Status — products that are ACTIVE (not draft/archived)
  const statusScore   = Math.round((activeCount / total) * 100);

  // 5. Title Quality — title is between 20–80 chars
  const withGoodTitle = raw.filter((p) => {
    const len = (p.title as string).length;
    return len >= 20 && len <= 80;
  }).length;
  const titleScore    = Math.round((withGoodTitle / total) * 100);

  // 6. Pricing — has a price > 0
  const withPrice     = raw.filter((p) => {
    const price = parseFloat(p.variants.edges[0]?.node?.price ?? "0");
    return price > 0;
  }).length;
  const pricingScore  = Math.round((withPrice / total) * 100);

  // ── Overall score ─────────────────────────────────────────────────────────
  // Weighted: inventory 30%, content 25%, visual 20%, status 10%, title 10%, pricing 5%
  const overallScore = Math.round(
    inventoryScore * 0.30 +
    contentScore   * 0.25 +
    visualScore    * 0.20 +
    statusScore    * 0.10 +
    titleScore     * 0.10 +
    pricingScore   * 0.05
  );

  const dimensions = [
    {
      key:   "inventory",
      label: "Inventory Health",
      icon:  "📦",
      score: inventoryScore,
      desc:  `${withStock} of ${activeCount} active products have stock`,
      tip:   inventoryScore < 80 ? "Restock out-of-stock products or hide them to prevent dead clicks." : null,
    },
    {
      key:   "content",
      label: "Content Quality",
      icon:  "📝",
      score: contentScore,
      desc:  `${withDesc} of ${total} products have a proper description`,
      tip:   contentScore < 80 ? "Add detailed descriptions — they boost SEO and conversion rates." : null,
    },
    {
      key:   "visual",
      label: "Visual Quality",
      icon:  "🖼️",
      score: visualScore,
      desc:  `${withImages} of ${total} products have at least one image`,
      tip:   visualScore < 80 ? "Add product photos — listings with images convert 3× better." : null,
    },
    {
      key:   "status",
      label: "Listing Status",
      icon:  "✅",
      score: statusScore,
      desc:  `${activeCount} of ${total} products are active (published)`,
      tip:   statusScore < 90 ? "Review draft products and publish those that are ready to sell." : null,
    },
    {
      key:   "title",
      label: "Title Quality",
      icon:  "✏️",
      score: titleScore,
      desc:  `${withGoodTitle} of ${total} products have an ideal title length (20–80 chars)`,
      tip:   titleScore < 80 ? "Keep titles descriptive but concise — aim for 30–60 characters." : null,
    },
    {
      key:   "pricing",
      label: "Pricing",
      icon:  "💰",
      score: pricingScore,
      desc:  `${withPrice} of ${total} products have a price set`,
      tip:   pricingScore < 100 ? "Set prices for all products to make them purchasable." : null,
    },
  ];

  // Worst products (lowest composite score)
  const worstProducts = raw
    .map((p) => {
      const desc   = (p.descriptionHtml as string).replace(/<[^>]+>/g, "").trim();
      const issues: string[] = [];
      if (p.status === "ACTIVE" && p.totalInventory === 0) issues.push("Out of stock");
      if (desc.length < 80)                                 issues.push("No description");
      if ((p.images.edges as any[]).length === 0)           issues.push("No images");
      if (p.status !== "ACTIVE")                            issues.push("Draft");
      const titleLen = (p.title as string).length;
      if (titleLen < 20 || titleLen > 80)                   issues.push("Title length");
      return { id: p.id, title: p.title as string, issues };
    })
    .filter((p) => p.issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length)
    .slice(0, 10);

  return { total, dimensions, overallScore, worstProducts };
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
  if (score >= 40) return "Needs Attention";
  return "Critical";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StoreHealthPage() {
  const { total, dimensions, overallScore, worstProducts } = useLoaderData<typeof loader>();

  const css = `
    @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
    @keyframes barGrow { from { width:0; } to { width:var(--bar-w); } }
    .sh-card { background:#fff; border:1px solid #e4e5e7; border-radius:16px; padding:24px; animation:fadeIn 0.35s ease both; }
    .sh-bar-bg { height:10px; background:#f1f2f3; border-radius:99px; overflow:hidden; margin-top:8px; }
    .sh-bar { height:100%; border-radius:99px; transition:width 1.2s ease; }
    .sh-badge { display:inline-flex; align-items:center; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:700; }
  `;

  if (total === 0) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>🛍️</div>
        <h2 style={{ color: "#1a1d1f", margin: "0 0 8px" }}>No products found</h2>
        <p style={{ color: "#6d7175", fontSize: "14px" }}>Add products to your store to see your health score.</p>
      </div>
    );
  }

  const color = scoreColor(overallScore);

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto", padding: "28px 20px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: "800", color: "#1a1d1f" }}>
          💪 Store Health
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#6d7175" }}>
          A breakdown of your store's product quality across {total} products.
        </p>
      </div>

      {/* Overall score */}
      <div className="sh-card" style={{
        marginBottom: "20px",
        background: `linear-gradient(160deg, ${color}18 0%, ${color}08 100%)`,
        border: `1.5px solid ${color}40`,
        display: "flex", alignItems: "center", gap: "32px",
      }}>
        {/* Circle score */}
        <div style={{ position: "relative", width: 130, height: 130, flexShrink: 0 }}>
          <svg width={130} height={130} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={65} cy={65} r={54} fill="none" stroke={`${color}30`} strokeWidth="10" />
            <circle
              cx={65} cy={65} r={54} fill="none"
              stroke={color} strokeWidth="10"
              strokeDasharray={2 * Math.PI * 54}
              strokeDashoffset={2 * Math.PI * 54 - (overallScore / 100) * 2 * Math.PI * 54}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 1.2s ease" }}
            />
          </svg>
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: "36px", fontWeight: "800", color, lineHeight: 1 }}>{overallScore}</span>
            <span style={{ fontSize: "11px", color: "#6d7175", fontWeight: "600" }}>/ 100</span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: "22px", fontWeight: "800", color, marginBottom: "6px" }}>
            {scoreLabel(overallScore)}
          </div>
          <div style={{ fontSize: "14px", color: "#6d7175", lineHeight: 1.7, maxWidth: "440px" }}>
            Based on {total} products analyzed across 6 health dimensions.
            {overallScore >= 80
              ? " Your store is in great shape! Keep monitoring regularly."
              : " Focus on the lower-scoring dimensions below for the biggest impact."}
          </div>
          <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {dimensions.filter((d) => d.tip).map((d) => (
              <span key={d.key} className="sh-badge" style={{ background: "#fff0f0", color: "#c0392b" }}>
                {d.icon} {d.label} needs work
              </span>
            ))}
            {!dimensions.some((d) => d.tip) && (
              <span className="sh-badge" style={{ background: "#f0faf5", color: "#008060" }}>
                ✅ All dimensions look great!
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Dimension breakdown */}
      <div className="sh-card" style={{ marginBottom: "20px" }}>
        <h2 style={{ margin: "0 0 20px", fontSize: "16px", fontWeight: "700", color: "#1a1d1f" }}>
          📊 Health Breakdown
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {dimensions.map((d, i) => (
            <div key={d.key} style={{ animationDelay: `${i * 0.06}s` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "16px" }}>{d.icon}</span>
                  <span style={{ fontSize: "14px", fontWeight: "700", color: "#1a1d1f" }}>{d.label}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "12px", color: "#6d7175" }}>{d.desc}</span>
                  <span style={{
                    fontSize: "13px", fontWeight: "800",
                    color: scoreColor(d.score), minWidth: "36px", textAlign: "right",
                  }}>
                    {d.score}%
                  </span>
                </div>
              </div>
              <div className="sh-bar-bg">
                <div
                  className="sh-bar"
                  style={{ width: `${d.score}%`, background: scoreColor(d.score) }}
                />
              </div>
              {d.tip && (
                <div style={{
                  marginTop: "6px", padding: "8px 12px",
                  background: "#fff8ed", borderRadius: "8px",
                  borderLeft: "3px solid #b97d00",
                  fontSize: "13px", color: "#7a5000",
                }}>
                  💡 {d.tip}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Products needing attention */}
      {worstProducts.length > 0 && (
        <div className="sh-card">
          <h2 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: "700", color: "#1a1d1f" }}>
            🚨 Products Needing Attention
          </h2>
          <div>
            {/* Header */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr auto",
              gap: "12px", padding: "8px 12px",
              fontSize: "11px", fontWeight: "700", color: "#6d7175",
              textTransform: "uppercase", letterSpacing: "0.7px",
              borderBottom: "2px solid #e4e5e7", marginBottom: "4px",
            }}>
              <span>Product</span>
              <span>Issues</span>
            </div>

            {worstProducts.map((p) => (
              <div key={p.id} style={{
                display: "grid", gridTemplateColumns: "1fr auto",
                gap: "12px", padding: "11px 12px",
                alignItems: "center",
                borderBottom: "1px solid #f1f2f3",
                transition: "background 0.15s",
              }}>
                <span style={{
                  fontSize: "14px", fontWeight: "600", color: "#1a1d1f",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.title}
                </span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {p.issues.map((issue) => (
                    <span key={issue} className="sh-badge" style={{
                      background: issue === "Out of stock" ? "#fff0f0"
                        : issue === "Draft" ? "#f0f1ff"
                        : "#f4f6f8",
                      color: issue === "Out of stock" ? "#c0392b"
                        : issue === "Draft" ? "#5c6ac4"
                        : "#6d7175",
                    }}>
                      {issue}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
