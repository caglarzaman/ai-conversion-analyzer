/**
 * GET/POST /api/analyze-product?productId=gid://shopify/Product/123
 *
 * Returns a structured AI analysis of a single Shopify product:
 * { conversion_score, title_suggestion, description_improvements,
 *   pricing_feedback, image_feedback }
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import Anthropic from "@anthropic-ai/sdk";
import { authenticate } from "../shopify.server";
import { trackUsage } from "../services/usage.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function analyze(admin: any, shop: string, productId: string) {
  const response = await admin.graphql(
    `#graphql
    query GetProduct($id: ID!) {
      product(id: $id) {
        id title status totalInventory
        descriptionHtml
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        images(first: 5) {
          edges { node { url altText width height } }
        }
        variants(first: 5) {
          edges { node { title price inventoryQuantity sku } }
        }
      }
    }`,
    { variables: { id: productId } }
  );

  const data = await response.json();
  if (data.errors || !data.data.product) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }

  const p = data.data.product;
  const description = p.descriptionHtml.replace(/<[^>]+>/g, "").trim();
  const price = `${p.priceRangeV2.minVariantPrice.amount} ${p.priceRangeV2.minVariantPrice.currencyCode}`;
  const imageCount = p.images.edges.length;
  const hasAltText = p.images.edges.some(({ node }: any) => node.altText);

  const prompt = `Analyze this Shopify product page and provide suggestions to increase conversion rate.

Title: "${p.title}"
Price: ${price}
Status: ${p.status}
Stock: ${p.totalInventory} units
Description (${description.length} chars): ${description.slice(0, 400) || "MISSING"}
Images: ${imageCount} (alt text: ${hasAltText ? "YES" : "NO"})
Variants: ${p.variants.edges.map(({ node }: any) => node.title).join(", ")}

Return ONLY this JSON (no markdown, no extra text):
{
  "conversion_score": 75,
  "title_suggestion": "improved title here",
  "description_improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "pricing_feedback": "one sentence about pricing strategy",
  "image_feedback": "one sentence about image quality and alt text"
}

conversion_score: 0-100 (honest assessment based on completeness and appeal)`;

  const msg = await anthropic.messages.create({
    model:      "claude-3-haiku-20240307",
    max_tokens: 450,
    messages:   [{ role: "user", content: prompt }],
  });

  const tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
  await trackUsage(shop, tokens).catch(() => {});

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : {};
    return Response.json({
      productId: p.id,
      productTitle: p.title,
      ...result,
    });
  } catch {
    return Response.json({ error: "Failed to parse AI response", raw: text }, { status: 500 });
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url       = new URL(request.url);
  const productId = url.searchParams.get("productId");
  if (!productId) return Response.json({ error: "productId query param required" }, { status: 400 });
  return analyze(admin, session.shop, productId);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body      = await request.json().catch(() => ({}));
  const productId = (body as any).productId;
  if (!productId) return Response.json({ error: "productId body field required" }, { status: 400 });
  return analyze(admin, session.shop, productId);
};
