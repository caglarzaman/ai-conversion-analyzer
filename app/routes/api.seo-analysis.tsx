/**
 * POST /api/seo-analysis
 * Body: { productId } OR { title, description, imageCount }
 *
 * Returns:
 * { seo_score, meta_title, meta_description, keywords, alt_text_suggestions }
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import Anthropic from "@anthropic-ai/sdk";
import { authenticate } from "../shopify.server";
import { trackUsage } from "../services/usage.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function runSeoAnalysis(
  admin: any,
  shop: string,
  input: { productId?: string; title?: string; description?: string; imageCount?: number }
) {
  let title = input.title ?? "";
  let description = input.description ?? "";
  let imageCount = input.imageCount ?? 0;

  // If productId given, fetch from Shopify
  if (input.productId) {
    const res = await admin.graphql(
      `#graphql
      query GetProductSeo($id: ID!) {
        product(id: $id) {
          title descriptionHtml
          images(first: 1) { edges { node { url } } }
        }
      }`,
      { variables: { id: input.productId } }
    );
    const data = await res.json();
    const p = data.data?.product;
    if (!p) return Response.json({ error: "Product not found" }, { status: 404 });
    title = p.title;
    description = p.descriptionHtml.replace(/<[^>]+>/g, "").trim();
    imageCount = p.images.edges.length;
  }

  const prompt = `You are an SEO expert for Shopify e-commerce. Analyze this product for SEO.

Title (${title.length} chars): "${title}"
Description (${description.length} chars): ${description.slice(0, 400) || "MISSING"}
Images: ${imageCount}

Return ONLY this JSON (no markdown):
{
  "seo_score": 72,
  "meta_title": "SEO-optimized title under 60 chars",
  "meta_description": "Compelling meta description 150-160 chars with primary keyword",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "alt_text_suggestions": ["alt text for image 1", "alt text for image 2"]
}

seo_score 0-100:
- Title 50-60 chars with keywords: +20
- Description >100 chars: +20
- Primary keyword in title: +20
- Has images: +20
- Meta description worthy: +20`;

  const msg = await anthropic.messages.create({
    model:      "claude-3-haiku-20240307",
    max_tokens: 400,
    messages:   [{ role: "user", content: prompt }],
  });

  const tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
  await trackUsage(shop, tokens).catch(() => {});

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";

  try {
    const match = text.match(/\{[\s\S]*\}/);
    return Response.json(match ? JSON.parse(match[0]) : { error: "Parse failed", raw: text });
  } catch {
    return Response.json({ error: "Failed to parse AI response" }, { status: 500 });
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json().catch(() => ({}));
  return runSeoAnalysis(admin, session.shop, body as any);
};

// GET with ?productId= for quick testing
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url       = new URL(request.url);
  const productId = url.searchParams.get("productId") ?? undefined;
  if (!productId) return Response.json({ error: "productId query param or POST body required" }, { status: 400 });
  return runSeoAnalysis(admin, session.shop, { productId });
};
