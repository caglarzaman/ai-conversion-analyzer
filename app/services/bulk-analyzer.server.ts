import Anthropic from "@anthropic-ai/sdk";
import db from "../db.server";
import { trackUsage } from "./usage.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ProductBatch {
  id: string;       // full GID
  shortId: string;  // numeric only
  title: string;
  price: string;
  hasDesc: boolean;
  imgCount: number;
}

export interface BatchResult {
  productId: string;
  conversionScore: number;
  seoScore: number;
  topIssue: string;
  quickFix: string;
}

/** Analyze up to 10 products in a single Claude call. Cost-efficient batch approach. */
export async function analyzeBatch(products: ProductBatch[], shop: string): Promise<BatchResult[]> {
  const list = products
    .map((p, i) =>
      `${i + 1}. ID:${p.shortId} | "${p.title}" | $${p.price} | Desc:${p.hasDesc ? "YES" : "NO"} | Images:${p.imgCount}`
    )
    .join("\n");

  const prompt = `Score these Shopify products for conversion rate and SEO. Return ONLY a JSON array, no other text.

Products:
${list}

For each product return exactly:
{"shortId":"X","conversionScore":75,"seoScore":60,"topIssue":"main problem in 8 words","quickFix":"best fix in 8 words"}

conversionScore 0-100: price clarity, product appeal, completeness
seoScore 0-100: title quality (length, keywords), description presence, image count
Be specific. No generic advice.`;

  const msg = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
  await trackUsage(shop, tokens).catch(() => {});

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "[]";

  try {
    // Extract JSON array even if model adds surrounding text
    const match = text.match(/\[[\s\S]*\]/);
    const parsed: any[] = match ? JSON.parse(match[0]) : [];

    return parsed.map((r) => {
      const product = products.find((p) => p.shortId === String(r.shortId));
      return {
        productId: product?.id ?? r.shortId,
        conversionScore: Math.max(0, Math.min(100, Number(r.conversionScore) || 50)),
        seoScore: Math.max(0, Math.min(100, Number(r.seoScore) || 50)),
        topIssue: r.topIssue ?? "Unknown issue",
        quickFix: r.quickFix ?? "Review product page",
      };
    });
  } catch {
    return products.map((p) => ({
      productId: p.id,
      conversionScore: 50,
      seoScore: 50,
      topIssue: "Analysis unavailable",
      quickFix: "Try again",
    }));
  }
}

/** Fetch all products from Shopify and run batch AI analysis. Stores results in DB. */
export async function runBulkAnalysis(admin: any, shop: string): Promise<void> {
  // Fetch up to 250 products
  const response = await admin.graphql(`#graphql
    query GetProductsForBulk {
      products(first: 250) {
        edges {
          node {
            id title status
            descriptionHtml
            priceRangeV2 { minVariantPrice { amount currencyCode } }
            images(first: 1) { edges { node { url } } }
          }
        }
      }
    }
  `);

  const data = await response.json();
  const products: ProductBatch[] = data.data.products.edges.map(({ node }: any) => ({
    id:       node.id,
    shortId:  node.id.split("/").pop() ?? node.id,
    title:    node.title,
    price:    node.priceRangeV2.minVariantPrice.amount,
    hasDesc:  node.descriptionHtml.replace(/<[^>]+>/g, "").trim().length > 20,
    imgCount: node.images.edges.length,
  }));

  // Batch into groups of 10
  const BATCH = 10;
  const results: BatchResult[] = [];
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const batchResults = await analyzeBatch(batch, shop);
    results.push(...batchResults);
    // Small delay to avoid rate limits
    if (i + BATCH < products.length) await new Promise((r) => setTimeout(r, 300));
  }

  // Upsert all results into DB
  for (const r of results) {
    const product = products.find((p) => p.id === r.productId);
    if (!product) continue;

    await db.productAnalysis.upsert({
      where:  { shop_productId: { shop, productId: r.productId } },
      update: {
        productTitle:    product.title,
        conversionScore: r.conversionScore,
        seoScore:        r.seoScore,
        topIssue:        r.topIssue,
        quickFix:        r.quickFix,
        applied:         false,
        analyzedAt:      new Date(),
      },
      create: {
        shop,
        productId:       r.productId,
        productTitle:    product.title,
        conversionScore: r.conversionScore,
        seoScore:        r.seoScore,
        topIssue:        r.topIssue,
        quickFix:        r.quickFix,
      },
    });
  }
}

/** Generate AI improvements (title + description) for one product and apply via mutation. */
export async function autoFixProduct(
  admin: any,
  shop: string,
  productId: string,
  title: string,
  description: string,
  price: string,
): Promise<{ ok: boolean; error?: string }> {
  const prompt = `You are a Shopify conversion expert. Improve this product for higher sales.

Product: "${title}"
Price: $${price}
Current description: ${description.replace(/<[^>]+>/g, "").trim().slice(0, 300) || "No description."}

Return ONLY this JSON (no markdown):
{
  "title": "improved title (max 70 chars, benefit-focused)",
  "description": "3 short paragraphs. Lead with key benefit. Include one emotional detail. End with soft CTA. Max 150 words. Plain text only."
}`;

  const msg = await anthropic.messages.create({
    model:      "claude-3-haiku-20240307",
    max_tokens: 400,
    messages:   [{ role: "user", content: prompt }],
  });

  const tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
  await trackUsage(shop, tokens).catch(() => {});

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";

  let improved: { title: string; description: string };
  try {
    const match = text.match(/\{[\s\S]*\}/);
    improved = match ? JSON.parse(match[0]) : { title, description };
  } catch {
    return { ok: false, error: "Failed to parse AI response" };
  }

  const descHtml = improved.description
    .split(/\n\n+/)
    .map((p: string) => `<p>${p.trim()}</p>`)
    .join("");

  const res = await admin.graphql(
    `#graphql
    mutation AutoFix($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id title }
        userErrors { field message }
      }
    }`,
    { variables: { input: { id: productId, title: improved.title, descriptionHtml: descHtml } } }
  );

  const result = await res.json();
  const errors = result.data?.productUpdate?.userErrors ?? [];

  if (errors.length > 0) {
    return { ok: false, error: errors[0].message };
  }

  await db.productAnalysis.updateMany({
    where: { shop, productId },
    data:  { applied: true },
  });

  return { ok: true };
}
