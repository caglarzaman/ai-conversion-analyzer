import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const first = Math.min(Number(url.searchParams.get("limit") ?? "50"), 250);
  const cursor = url.searchParams.get("cursor") ?? null;

  const response = await admin.graphql(
    `#graphql
    query GetProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            descriptionHtml
            status
            totalInventory
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
              maxVariantPrice {
                amount
                currencyCode
              }
            }
            images(first: 5) {
              edges {
                node {
                  url
                  altText
                  width
                  height
                }
              }
            }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  price
                  inventoryQuantity
                  sku
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { first, after: cursor } },
  );

  const data = await response.json();

  if (data.errors) {
    return Response.json(
      { error: "GraphQL error", details: data.errors },
      { status: 500 },
    );
  }

  const { products } = data.data;

  const items = products.edges.map(({ node }: any) => ({
    id: node.id,
    title: node.title,
    description: node.descriptionHtml,
    status: node.status,
    totalInventory: node.totalInventory,
    price: {
      min: node.priceRangeV2.minVariantPrice,
      max: node.priceRangeV2.maxVariantPrice,
    },
    images: node.images.edges.map(({ node: img }: any) => ({
      url: img.url,
      altText: img.altText,
      width: img.width,
      height: img.height,
    })),
    variants: node.variants.edges.map(({ node: v }: any) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      inventory: v.inventoryQuantity,
      sku: v.sku,
    })),
  }));

  return Response.json({
    products: items,
    pagination: {
      hasNextPage: products.pageInfo.hasNextPage,
      endCursor: products.pageInfo.endCursor,
    },
    total: items.length,
  });
};
