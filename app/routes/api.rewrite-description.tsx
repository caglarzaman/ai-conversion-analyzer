/**
 * POST /api/rewrite-description
 * Body: { productId } OR { title, description, price, tone? }
 *
 * Returns:
 * { headline, description, bullet_points }
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import Anthropic from "@anthropic-ai/sdk";
import { authenticate } from "../shopify.server";
import { trackUsage } from "../services/usage.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TONE_MAP: Record<string, string> = {
  professional: "authoritative and trust-building",
  friendly:     "warm and conversational",
  luxury:       "premium and aspirational",
  playful:      "energetic and fun",
};

async function rewrite(
  admin: any,
  shop: string,
  input: { productId?: string; title?: string; description?: string; price?: string; tone?: string }
) {
  let title = input.title ?? "";
  let description = input.description ?? "";
  let price = input.price ?? "";
  const tone = TONE_MAP[input.tone ?? "professional"] ?? TONE_MAP.professional;

  if (input.productId) {
    const res = await admin.graphql(
      `#graphql
      query GetProductForRewrite($id: ID!) {
        product(id: $id) {
          title descriptionHtml
          priceRangeV2 { minVariantPrice { amount currencyCode } }
        }
      }`,
      { variables: { id: input.productId } }
    );
    const data = await res.json();
    const p = data.data?.product;
    if (!p) return Response.json({ error: "Product not found" }, { status: 404 });
    title = p.title;
    description = p.descriptionHtml.replace(/<[^>]+>/g, "").trim();
    price = `${p.priceRangeV2.minVariantPrice.amount} ${p.priceRangeV2.minVariantPrice.currencyCode}`;
  }

  const prompt = `Rewrite this Shopify product content for higher conversions. Tone: ${tone}.

Product: "${title}"
Price: ${price}
Current description: ${description.slice(0, 300) || "No description yet."}

Return ONLY this JSON (no markdown):
{
  "headline": "powerful benefit-focused headline under 80 chars",
  "description": "2-3 paragraph rewritten description, max 180 words, plain text",
  "bullet_points": [
    "✓ Key benefit 1",
    "✓ Key benefit 2",
    "✓ Key benefit 3",
    "✓ Key benefit 4"
  ]
}`;

  const msg = await anthropic.messages.create({
    model:      "claude-3-haiku-20240307",
    max_tokens: 500,
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
  return rewrite(admin, session.shop, body as any);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url       = new URL(request.url);
  const productId = url.searchParams.get("productId") ?? undefined;
  if (!productId) return Response.json({ error: "productId query param or POST body required" }, { status: 400 });
  return rewrite(admin, session.shop, { productId });
};
