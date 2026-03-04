import type { ActionFunctionArgs } from "react-router";
import Anthropic from "@anthropic-ai/sdk";
import { authenticate } from "../shopify.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Analyze a single product with Claude and return structured suggestions.
async function analyzeProduct(product: {
  title: string;
  description: string;
  price: string;
}): Promise<{
  conversionTips: string[];
  headlineSuggestion: string;
  descriptionImprovement: string;
  pricingSuggestion: string;
}> {
  const prompt = `You are a Shopify conversion rate optimization expert.

Product title: ${product.title}
Price: ${product.price}
Description (HTML stripped): ${product.description.replace(/<[^>]+>/g, "").trim().slice(0, 500) || "No description provided."}

Respond in this exact JSON format (no markdown, no extra text):
{
  "conversionTips": ["tip 1", "tip 2", "tip 3"],
  "headlineSuggestion": "Improved product title here",
  "descriptionImprovement": "Improved description here (2-3 sentences)",
  "pricingSuggestion": "Pricing advice here (1 sentence)"
}`;

  const msg = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : "{}";

  try {
    return JSON.parse(text);
  } catch {
    return {
      conversionTips: ["Unable to parse AI response."],
      headlineSuggestion: product.title,
      descriptionImprovement: "No suggestion available.",
      pricingSuggestion: "No suggestion available.",
    };
  }
}

// POST /api/analyze-products
// Body (optional): { "productIds": ["gid://shopify/Product/123", ...] }
// If no productIds given, analyzes the first 5 products.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Parse optional product ID filter from request body
  let productIds: string[] | null = null;
  try {
    const body = await request.json();
    if (Array.isArray(body?.productIds) && body.productIds.length > 0) {
      productIds = body.productIds;
    }
  } catch {
    // no body or not JSON — use default
  }

  // Fetch products from Shopify
  const response = await admin.graphql(
    `#graphql
    query GetProductsForAnalysis($first: Int!) {
      products(first: $first) {
        edges {
          node {
            id
            title
            descriptionHtml
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }`,
    { variables: { first: productIds ? 250 : 5 } },
  );

  const data = await response.json();

  if (data.errors) {
    return Response.json(
      { error: "GraphQL error", details: data.errors },
      { status: 500 },
    );
  }

  let products: any[] = data.data.products.edges.map(({ node }: any) => node);

  // Filter to requested IDs if provided
  if (productIds) {
    products = products.filter((p) => productIds!.includes(p.id));
  }

  if (products.length === 0) {
    return Response.json({ error: "No products found." }, { status: 404 });
  }

  // Cap at 10 to limit AI cost
  const toAnalyze = products.slice(0, 10);

  // Run AI analysis for each product (sequentially to avoid rate limits)
  const results = [];
  for (const product of toAnalyze) {
    const price = `${product.priceRangeV2.minVariantPrice.amount} ${product.priceRangeV2.minVariantPrice.currencyCode}`;
    const suggestions = await analyzeProduct({
      title: product.title,
      description: product.descriptionHtml,
      price,
    });

    results.push({
      id: product.id,
      title: product.title,
      price,
      suggestions,
    });
  }

  return Response.json({
    analyzed: results.length,
    results,
  });
};

// Also support GET for quick testing (analyzes first 3 products)
export const loader = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query GetProductsForAnalysis($first: Int!) {
      products(first: $first) {
        edges {
          node {
            id
            title
            descriptionHtml
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }`,
    { variables: { first: 3 } },
  );

  const data = await response.json();

  if (data.errors) {
    return Response.json(
      { error: "GraphQL error", details: data.errors },
      { status: 500 },
    );
  }

  const products = data.data.products.edges.map(({ node }: any) => node);

  const results = [];
  for (const product of products) {
    const price = `${product.priceRangeV2.minVariantPrice.amount} ${product.priceRangeV2.minVariantPrice.currencyCode}`;
    const suggestions = await analyzeProduct({
      title: product.title,
      description: product.descriptionHtml,
      price,
    });

    results.push({
      id: product.id,
      title: product.title,
      price,
      suggestions,
    });
  }

  return Response.json({
    analyzed: results.length,
    results,
  });
};
