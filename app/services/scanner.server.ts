import db from "../db.server";
import { analyzeStore } from "./ai-analyzer.server";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  title: string;
  totalInventory: number;
  status: string;
}

export type IssueType = "out-of-stock" | "low-inventory" | "draft";

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
            }
            cursor
          }
          pageInfo {
            hasNextPage
          }
        }
      }`,
      { variables: { first: PAGE_SIZE, after: cursor } }
    );

    const data = await response.json();
    const edges: any[] = data.data.products.edges;

    products.push(...edges.map((e) => e.node as Product));
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
    if (p.totalInventory === 0 && p.status === "ACTIVE") {
      issues.push({ productId: p.id, title: p.title, inventory: p.totalInventory, status: p.status, issueType: "out-of-stock" });
    } else if (p.totalInventory > 0 && p.totalInventory < 5) {
      issues.push({ productId: p.id, title: p.title, inventory: p.totalInventory, status: p.status, issueType: "low-inventory" });
    } else if (p.status === "DRAFT") {
      issues.push({ productId: p.id, title: p.title, inventory: p.totalInventory, status: p.status, issueType: "draft" });
    }
  }

  // Sort by severity: out-of-stock → low-inventory → draft
  const priority: Record<IssueType, number> = { "out-of-stock": 0, "low-inventory": 1, draft: 2 };
  return issues.sort((a, b) => priority[a.issueType] - priority[b.issueType]);
}

// ─── Score formula ────────────────────────────────────────────────────────────

function computeScore(oos: number, low: number, draft: number): number {
  return Math.max(0, Math.min(100, 100 - oos * 10 - low * 5 - draft * 2));
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

  // 3. Compute score
  const score = computeScore(outOfStockCount, lowInventoryCount, draftCount);

  // 4. AI — one call for the whole store, skipped when healthy
  const hasIssues = outOfStockCount > 0 || lowInventoryCount > 0 || draftCount > 0;
  let aiInsights = "Your store is in great shape — no conversion issues detected.";

  if (hasIssues) {
    aiInsights = await analyzeStore({
      totalProducts:  products.length,
      outOfStock:     outOfStockCount,
      lowInventory:   lowInventoryCount,
      activeProducts: activeCount,
      draftProducts:  draftCount,
      riskyTitles:    issues.slice(0, 5).map((i) => i.title),
    });
  }

  // 5. Persist report (delete previous reports for this shop first to keep DB lean)
  await db.scanReport.deleteMany({ where: { shop } });

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
