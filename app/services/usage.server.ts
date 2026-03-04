import db from "../db.server";

/** Record an AI call for a shop. Call after every Anthropic API request. */
export async function trackUsage(shop: string, tokens: number) {
  const month = new Date().toISOString().slice(0, 7); // "2026-03"
  await db.aiUsage.upsert({
    where: { shop_month: { shop, month } },
    update: {
      calls:  { increment: 1 },
      tokens: { increment: tokens },
    },
    create: { shop, month, calls: 1, tokens },
  });
}

/** Return usage stats for a shop (current + last month). */
export async function getUsage(shop: string) {
  const now   = new Date();
  const thisM = now.toISOString().slice(0, 7);
  const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toISOString().slice(0, 7);

  const rows = await db.aiUsage.findMany({
    where: { shop, month: { in: [thisM, lastM] } },
  });

  const current  = rows.find((r) => r.month === thisM);
  const previous = rows.find((r) => r.month === lastM);

  // claude-3-haiku pricing: $0.25/1M input, $1.25/1M output
  // We track combined tokens — estimate blended at $0.50/1M
  const costPerToken = 0.0000005;

  return {
    month: thisM,
    calls:     current?.calls  ?? 0,
    tokens:    current?.tokens ?? 0,
    costUsd:   ((current?.tokens ?? 0) * costPerToken).toFixed(4),
    prevCalls:  previous?.calls  ?? 0,
    prevTokens: previous?.tokens ?? 0,
  };
}
