import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import Anthropic from "@anthropic-ai/sdk";
import db from "../db.server";
import { trackUsage } from "../services/usage.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TONES = [
  { key: "professional", label: "Professional", emoji: "👔", desc: "Clear, trust-building copy" },
  { key: "friendly",     label: "Friendly",     emoji: "😊", desc: "Warm, approachable tone"   },
  { key: "luxury",       label: "Luxury",        emoji: "✨", desc: "Premium, aspirational feel" },
  { key: "playful",      label: "Playful",       emoji: "🎉", desc: "Fun, energetic & bold"     },
];

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const url   = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? "needs-description"; // all | needs-description
  const cursor = url.searchParams.get("cursor") ?? null;

  const response = await admin.graphql(
    `#graphql
    query GetProductsForGen($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id title status
            descriptionHtml
            priceRangeV2 { minVariantPrice { amount currencyCode } }
            images(first: 1) { edges { node { url altText } } }
          }
        }
      }
    }`,
    { variables: { first: 250, after: cursor } }
  );

  const data = await response.json();
  const allProducts = data.data.products.edges.map(({ node }: any) => ({
    id:    node.id,
    title: node.title,
    status: node.status,
    price: `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}`,
    currentDescription: node.descriptionHtml.replace(/<[^>]+>/g, "").trim(),
    hasDescription: node.descriptionHtml.replace(/<[^>]+>/g, "").trim().length > 20,
    image: node.images.edges[0]?.node ?? null,
  }));

  const products = filter === "needs-description"
    ? allProducts.filter((p: any) => !p.hasDescription)
    : allProducts;

  // Load previously generated descriptions for this shop
  const generated = await db.generatedDescription.findMany({
    where:   { shop: session.shop },
    orderBy: { createdAt: "desc" },
    select:  { productId: true, content: true, tone: true, applied: true, createdAt: true },
  });

  const generatedMap: Record<string, { content: string; tone: string; applied: boolean }> = {};
  for (const g of generated) {
    if (!generatedMap[g.productId]) {
      generatedMap[g.productId] = { content: g.content, tone: g.tone, applied: g.applied };
    }
  }

  return {
    products,
    filter,
    pageInfo: data.data.products.pageInfo,
    generatedMap,
    shop: session.shop,
    totalNeedsDescription: allProducts.filter((p: any) => !p.hasDescription).length,
    total: allProducts.length,
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const formData  = await request.formData();
  const intent    = formData.get("intent") as string;
  const productId = formData.get("productId") as string;

  // ── Generate ──────────────────────────────────────────────────────────────

  if (intent === "generate") {
    const title   = formData.get("title") as string;
    const price   = formData.get("price") as string;
    const tone    = formData.get("tone") as string;
    const current = (formData.get("currentDescription") as string) || "";

    const toneMap: Record<string, string> = {
      professional: "professional and authoritative — clear benefits, builds trust",
      friendly:     "warm and conversational — like advice from a knowledgeable friend",
      luxury:       "premium and aspirational — evoke desire and exclusivity",
      playful:      "energetic and fun — bold, punchy sentences with personality",
    };

    const prompt = `You are an expert Shopify copywriter. Write a high-converting product description.

Product: "${title}"
Price: ${price}
Tone: ${toneMap[tone] ?? "professional"}
${current ? `Current description (improve on this): ${current.slice(0, 200)}` : "No description yet — write from scratch."}

Rules:
• 2–3 short paragraphs
• Lead with the customer's #1 benefit, not a feature list
• Include one emotional or sensory detail
• End with a soft call-to-action
• Max 180 words
• Plain text only — NO HTML, NO markdown, NO bullet points

Write ONLY the description. Nothing else.`;

    const msg = await anthropic.messages.create({
      model:     "claude-3-haiku-20240307",
      max_tokens: 350,
      messages:  [{ role: "user", content: prompt }],
    });

    const content = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
    const tokens  = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);

    await trackUsage(session.shop, tokens);

    // Save to DB
    await db.generatedDescription.create({
      data: { shop: session.shop, productId, productTitle: title, tone, content },
    });

    return { intent: "generate", productId, content, ok: true };
  }

  // ── Apply to Shopify ──────────────────────────────────────────────────────

  if (intent === "apply") {
    const content = formData.get("content") as string;

    // Wrap paragraphs in HTML
    const descriptionHtml = content
      .split(/\n\n+/)
      .map((p: string) => `<p>${p.trim()}</p>`)
      .join("");

    const res = await admin.graphql(
      `#graphql
      mutation UpdateDescription($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id title }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: productId, descriptionHtml } } }
    );

    const result = await res.json();
    const errors = result.data?.productUpdate?.userErrors ?? [];

    if (errors.length > 0) {
      return { intent: "apply", productId, ok: false, error: errors[0].message };
    }

    // Mark as applied in DB
    await db.generatedDescription.updateMany({
      where: { shop: session.shop, productId },
      data:  { applied: true },
    });

    return { intent: "apply", productId, ok: true };
  }

  return { intent: "unknown", productId, ok: false };
};

// ─── CSS ──────────────────────────────────────────────────────────────────────

const css = `
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }
  @keyframes spin   { to{transform:rotate(360deg)} }
  @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }

  .g-card {
    background:#fff; border-radius:16px; border:1px solid #e4e5e7;
    padding:20px; box-shadow:0 1px 3px rgba(0,0,0,0.06);
    animation:fadeIn 0.3s ease both; transition:box-shadow 0.2s;
  }
  .g-card:hover { box-shadow:0 4px 14px rgba(0,0,0,0.09); }
  .g-tone-btn {
    padding:8px 14px; border-radius:10px; border:2px solid #e4e5e7;
    background:#fff; cursor:pointer; font-size:13px; font-weight:600;
    transition:all 0.15s; color:#1a1d1f;
  }
  .g-tone-btn:hover { border-color:#667eea; color:#667eea; }
  .g-tone-btn.active { border-color:#667eea; background:#f0f1ff; color:#667eea; }
  .g-gen-btn {
    display:inline-flex; align-items:center; gap:6px;
    padding:9px 18px; border-radius:10px; font-size:13px; font-weight:700;
    cursor:pointer; border:none;
    background:linear-gradient(135deg,#667eea,#764ba2);
    color:white; box-shadow:0 3px 10px rgba(102,126,234,0.35);
    transition:all 0.2s;
  }
  .g-gen-btn:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 5px 15px rgba(102,126,234,0.45); }
  .g-gen-btn:disabled { opacity:0.6; cursor:not-allowed; transform:none; }
  .g-apply-btn {
    display:inline-flex; align-items:center; gap:6px;
    padding:9px 18px; border-radius:10px; font-size:13px; font-weight:700;
    cursor:pointer; border:none;
    background:linear-gradient(135deg,#00b374,#008060);
    color:white; box-shadow:0 3px 10px rgba(0,179,116,0.35);
    transition:all 0.2s;
  }
  .g-apply-btn:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 5px 15px rgba(0,179,116,0.45); }
  .g-apply-btn:disabled { opacity:0.6; cursor:not-allowed; transform:none; }
  .g-spinner { width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,0.4);border-top-color:white;animation:spin 0.8s linear infinite; }
  .g-badge { display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:12px;font-weight:600; }
  .g-filter-tab {
    padding:8px 16px; border-radius:10px; font-size:13px; font-weight:600;
    cursor:pointer; text-decoration:none; border:none;
    transition:all 0.15s;
  }
  .g-result-box {
    background:#f8f9ff; border-radius:12px; padding:16px;
    border-left:4px solid #667eea; margin-top:16px;
    font-size:14px; line-height:1.8; color:#1a1d1f; white-space:pre-wrap;
  }
  .g-copy-btn {
    display:inline-flex;align-items:center;gap:4px;
    padding:5px 12px; border-radius:8px; font-size:12px; font-weight:600;
    cursor:pointer; border:1px solid #d0d5ff; background:#f0f1ff; color:#667eea;
    transition:all 0.15s;
  }
  .g-copy-btn:hover { background:#667eea; color:white; }
`;

// ─── Product Card ─────────────────────────────────────────────────────────────

function ProductGenCard({
  product,
  savedResult,
}: {
  product: any;
  savedResult: { content: string; tone: string; applied: boolean } | null;
}) {
  const genFetcher   = useFetcher<typeof action>();
  const applyFetcher = useFetcher<typeof action>();

  const isGenerating = genFetcher.state !== "idle";
  const isApplying   = applyFetcher.state !== "idle";

  // Use freshly generated content, fall back to saved
  const freshGen = genFetcher.data?.intent === "generate" && genFetcher.data.productId === product.id
    ? genFetcher.data
    : null;
  const displayContent = freshGen?.content ?? savedResult?.content ?? null;
  const applied = applyFetcher.data?.ok === true
    || (!freshGen && savedResult?.applied);

  // Local tone state — track via hidden input trick with default
  const defaultTone = savedResult?.tone ?? "professional";

  return (
    <div className="g-card">
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>

        {/* Thumbnail */}
        <div style={{
          width: 64, height: 64, borderRadius: 10, flexShrink: 0,
          background: "#f4f6f8", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid #e4e5e7",
        }}>
          {product.image
            ? <img src={product.image.url} alt={product.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: 26 }}>📦</span>}
        </div>

        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#1a1d1f" }}>{product.title}</span>
            <span style={{ fontSize: 13, color: "#6d7175" }}>{product.price}</span>
            {applied && <span className="g-badge" style={{ background: "#f0faf5", color: "#008060" }}>✅ Applied</span>}
            {displayContent && !applied && <span className="g-badge" style={{ background: "#fff8ed", color: "#b97d00" }}>📝 Generated</span>}
            {!product.hasDescription && !displayContent && (
              <span className="g-badge" style={{ background: "#fff0f0", color: "#c0392b" }}>⚠️ No description</span>
            )}
          </div>

          {product.currentDescription && !displayContent && (
            <p style={{ margin: 0, fontSize: 12, color: "#6d7175", lineHeight: 1.5 }}>
              Current: {product.currentDescription.slice(0, 100)}{product.currentDescription.length > 100 ? "…" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Generator form */}
      <genFetcher.Form method="post" style={{ marginTop: 14 }}>
        <input type="hidden" name="intent"             value="generate" />
        <input type="hidden" name="productId"          value={product.id} />
        <input type="hidden" name="title"              value={product.title} />
        <input type="hidden" name="price"              value={product.price} />
        <input type="hidden" name="currentDescription" value={product.currentDescription} />

        {/* Tone picker */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>
            Writing Tone
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TONES.map((t) => (
              <label key={t.key} style={{ cursor: "pointer" }}>
                <input type="radio" name="tone" value={t.key} defaultChecked={t.key === defaultTone} style={{ display: "none" }} />
                <span
                  className={`g-tone-btn${(defaultTone === t.key) ? " active" : ""}`}
                  onClick={(e) => {
                    // Toggle active class visually
                    const form = (e.currentTarget as HTMLElement).closest("form");
                    form?.querySelectorAll(".g-tone-btn").forEach((b) => b.classList.remove("active"));
                    (e.currentTarget as HTMLElement).classList.add("active");
                  }}
                >
                  {t.emoji} {t.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <button type="submit" className="g-gen-btn" disabled={isGenerating}>
          {isGenerating
            ? <><div className="g-spinner" /> Generating...</>
            : <><span>✨</span> {displayContent ? "Regenerate" : "Generate Description"}</>
          }
        </button>
      </genFetcher.Form>

      {/* Generated result */}
      {displayContent && (
        <div>
          <div className="g-result-box">
            {displayContent}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <applyFetcher.Form method="post">
              <input type="hidden" name="intent"    value="apply" />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="content"   value={displayContent} />
              <button
                type="submit"
                className="g-apply-btn"
                disabled={isApplying || applied}
              >
                {isApplying
                  ? <><div className="g-spinner" /> Applying...</>
                  : applied
                  ? <>✅ Applied to Shopify</>
                  : <><span>🚀</span> Apply to Shopify</>
                }
              </button>
            </applyFetcher.Form>

            <button
              className="g-copy-btn"
              type="button"
              onClick={() => navigator.clipboard.writeText(displayContent)}
            >
              📋 Copy
            </button>

            <span style={{ fontSize: 12, color: "#6d7175", marginLeft: "auto" }}>
              {displayContent.split(" ").length} words
            </span>
          </div>

          {applyFetcher.data?.ok === false && (
            <div style={{ marginTop: 8, color: "#c0392b", fontSize: 13 }}>
              ❌ {(applyFetcher.data as any).error ?? "Failed to apply. Try again."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GeneratePage() {
  const { products, filter, generatedMap, totalNeedsDescription, total } =
    useLoaderData<typeof loader>();

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1d1f", letterSpacing: "-0.5px" }}>
          ✨ AI Description Generator
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6d7175" }}>
          Generate high-converting product descriptions with Claude AI — then apply them to Shopify in one click.
        </p>
      </div>

      {/* Stats banner */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24,
      }}>
        <div style={{ background: "#fff0f0", borderRadius: 14, padding: "16px 20px", border: "1px solid #ffd6d6" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#c0392b" }}>{totalNeedsDescription}</div>
          <div style={{ fontSize: 13, color: "#c0392b", fontWeight: 600, marginTop: 2 }}>Missing Descriptions</div>
        </div>
        <div style={{ background: "#f0faf5", borderRadius: 14, padding: "16px 20px", border: "1px solid #c3e6d9" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#008060" }}>
            {Object.values(generatedMap).filter((g) => g.applied).length}
          </div>
          <div style={{ fontSize: 13, color: "#008060", fontWeight: 600, marginTop: 2 }}>Applied This Month</div>
        </div>
        <div style={{ background: "#f8f9ff", borderRadius: 14, padding: "16px 20px", border: "1px solid #d0d5ff" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#667eea" }}>{total}</div>
          <div style={{ fontSize: 13, color: "#667eea", fontWeight: 600, marginTop: 2 }}>Total Products</div>
        </div>
      </div>

      {/* Info banner */}
      <div style={{
        background: "linear-gradient(135deg,#667eea15,#764ba215)",
        border: "1px solid #d0d5ff", borderRadius: 14,
        padding: "14px 18px", marginBottom: 20,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{ fontSize: 24, flexShrink: 0 }}>💡</span>
        <div style={{ fontSize: 13, color: "#1a1d1f", lineHeight: 1.6 }}>
          <strong>Choose a tone, click Generate, review, then Apply.</strong> Descriptions are written by Claude AI and saved automatically. You can regenerate as many times as you want before applying.
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <a
          href="?filter=needs-description"
          className="g-filter-tab"
          style={{
            background: filter === "needs-description" ? "#667eea" : "#f4f6f8",
            color: filter === "needs-description" ? "white" : "#1a1d1f",
          }}
        >
          ⚠️ Needs Description ({totalNeedsDescription})
        </a>
        <a
          href="?filter=all"
          className="g-filter-tab"
          style={{
            background: filter === "all" ? "#667eea" : "#f4f6f8",
            color: filter === "all" ? "white" : "#1a1d1f",
          }}
        >
          📦 All Products ({total})
        </a>
      </div>

      {/* Product list */}
      {products.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#6d7175" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1d1f", marginBottom: 8 }}>All products have descriptions!</div>
          <div style={{ fontSize: 14 }}>Switch to "All Products" to regenerate or improve any description.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {products.map((product: any, i: number) => (
            <div key={product.id} style={{ animationDelay: `${i * 0.03}s` }}>
              <ProductGenCard
                product={product}
                savedResult={generatedMap[product.id] ?? null}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
