import Anthropic from "@anthropic-ai/sdk";
import { trackUsage } from "./usage.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface StoreMetrics {
  totalProducts: number;
  outOfStock: number;
  lowInventory: number;
  activeProducts: number;
  draftProducts: number;
  riskyTitles: string[];
}

export async function analyzeStore(metrics: StoreMetrics, shop?: string): Promise<string> {
  const prompt = `Shopify conversion audit. Reply with exactly 4 bullet points, no intro.

Store: ${metrics.totalProducts} products — ${metrics.activeProducts} active, ${metrics.draftProducts} draft.
Issues: ${metrics.outOfStock} out of stock, ${metrics.lowInventory} low inventory (<5 units).
At-risk products: ${metrics.riskyTitles.join(", ") || "none"}.

Give specific, actionable fixes. Bullet points only.`;

  const msg = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 180,
    messages: [{ role: "user", content: prompt }],
  });

  if (shop) {
    const tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
    await trackUsage(shop, tokens).catch(() => {}); // non-blocking
  }

  const block = msg.content[0];
  return block.type === "text" ? block.text : "";
}
