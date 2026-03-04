import db from "../db.server";
import { analyzeStore } from "./ai-analyzer.server";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  title: string;
  totalInventory: number;
  status: string;
  hasDescription: boolean;
  hasImages: boolean;
}

export type IssueType =
  | "out-of-stock"
  | "low-inventory"
  | "draft"
  | "no-description"
  | "no-images"
  | "short-title";

interface ScanIssue {
  productId: string;
  title: string;
  inventory: number;
  status: string;
  issueType: IssueType;
}

// ─── Product fetcher (cursor pagination) ─────────────────────────────────────

const PAGE_SIZE = 250;
const MAX_PAGES = 10; // safety cap: 2,500 products

async function fetchAllProducts(admin: any): Promise<Product[]> {
  const products: Product[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let page = 0;

  while (hasNextPage && page < MAX_PAGES) {
    const response = await admin.graphql(
      `#graphql
      query GetAllProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            node {
              id
              title
              totalInventory
              status
              descriptionHtml
              images(first: 1) {
                edges { node { url } }
              }
            }
            cursor
          }
          pageInfo { hasNextPage }
        }
      }`,
      { variables: { first: PAGE_SIZE, after: cursor } }
    );

    const data = await response.json();
    const edges: any[] = data.data.products.edges;

    products.push(
      ...edges.map((e) => ({
        id: e.node.id,
        title: e.node.title,
        totalInventory: e.node.totalInventory,
        status: e.node.status,
        hasDescription:
          !!e.node.descriptionHtml &&
          e.node.descriptionHtml.replace(/<[^>]+>/g, "").trim().length > 20,
        hasImages: e.node.images.edges.length > 0,
      }))
    );

    hasNextPage = data.data.products.pageInfo.hasNextPage;
    cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
    page++;
  }

  return products;
}

// ─── Issue detector ───────────────────────────────────────────────────────────

function detectIssues(products: Product[]): ScanIssue[] {
  const issues: ScanIssue[] = [];

  for (const p of products) {
    // Inventory issues (only for active products)
    if (p.totalInventory === 0 && p.status === "ACTIVE") {
      issues.push({ productId: p.id, title: p.title, inventory: p.totalInventory, status: p.status, issueType: "out-of-stock" });
    } else if (p.totalInventory > 0 && p.totalInventory < 5 && p.status === "ACTIVE") {
      issues.push({ productId: p.id, title: p.title, inventory: p.totalInventory, status: p.status, issueType: "low-inventory" });
    }

    // Draft
    if (p.status === "DRAFT") {
      issues.push({ productId: p.id, title: p.title, inventory: p.totalInventory, status: p.status, issueType: "draft" });
    }

    // SEO issues (check all products)
    if (!p.hasDescription) {
      issues.push({ productId: p.id, title: p.title, inventory: p.totalInventory, status: p.status, issueType: "no-description" });
    }
    if (!p.hasImages) {
      issues.push({ productId: p.id, title: p.title, inventory: p.totalInventory, status: p.status, issueType: "no-images" });
    }
    if (p.title.trim().length < 20) {
      issues.push({ productId: p.id, title: p.title, inventory: p.totalInventory, status: p.status, issueType: "short-title" });
    }
  }

  // Sort by severity
  const priority: Record<IssueType, number> = {
    "out-of-stock":   0,
    "low-inventory":  1,
    draft:            2,
    "no-description": 3,
    "no-images":      4,
    "short-title":    5,
  };
  return issues.sort((a, b) => priority[a.issueType] - priority[b.issueType]);
}

// ─── Score formula ────────────────────────────────────────────────────────────

function computeScore(issues: ScanIssue[]): number {
  const oos   = issues.filter((i) => i.issueType === "out-of-stock").length;
  const low   = issues.filter((i) => i.issueType === "low-inventory").length;
  const draft = issues.filter((i) => i.issueType === "draft").length;
  const seo   = issues.filter((i) => ["no-description", "no-images", "short-title"].includes(i.issueType)).length;

  return Math.max(0, Math.min(100, 100 - oos * 10 - low * 5 - draft * 2 - seo * 3));
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runFullScan(admin: any, shop: string) {
  // 1. Fetch entire catalogue
  const products = await fetchAllProducts(admin);

  // 2. Detect issues
  const issues = detectIssues(products);

  const outOfStockCount   = issues.filter((i) => i.issueType === "out-of-stock").length;
  const lowInventoryCount = issues.filter((i) => i.issueType === "low-inventory").length;
  const draftCount        = issues.filter((i) => i.issueType === "draft").length;
  const activeCount       = products.filter((p) => p.status === "ACTIVE").length;

  // 3. Score
  const score = computeScore(issues);

  // 4. AI — one call, skipped when healthy
  const hasIssues = issues.length > 0;
  let aiInsights = "Your store is in great shape — no conversion or SEO issues detected.";

  if (hasIssues) {
    aiInsights = await analyzeStore({
      totalProducts:  products.length,
      outOfStock:     outOfStockCount,
      lowInventory:   lowInventoryCount,
      activeProducts: activeCount,
      draftProducts:  draftCount,
      riskyTitles:    issues.slice(0, 5).map((i) => i.title),
    }, shop);
  }

  // 5. Keep last 10 scans — delete oldest beyond limit
  const existing = await db.scanReport.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing.length >= 10) {
    const toDelete = existing.slice(9).map((r) => r.id);
    await db.scanReport.deleteMany({ where: { id: { in: toDelete } } });
  }

  // 6. Save new report
  const report = await db.scanReport.create({
    data: {
      shop,
      score,
      aiInsights,
      totalProducts: products.length,
      outOfStock:    outOfStockCount,
      lowInventory:  lowInventoryCount,
      draftCount,
      issues: {
        create: issues.map((i) => ({
          productId: i.productId,
          title:     i.title,
          inventory: i.inventory,
          status:    i.status,
          issueType: i.issueType,
        })),
      },
    },
    include: { issues: true },
  });

  return report;
}
