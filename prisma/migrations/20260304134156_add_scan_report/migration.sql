-- CreateTable
CREATE TABLE "ScanReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "aiInsights" TEXT NOT NULL,
    "totalProducts" INTEGER NOT NULL,
    "outOfStock" INTEGER NOT NULL,
    "lowInventory" INTEGER NOT NULL,
    "draftCount" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "ProductIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "inventory" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    CONSTRAINT "ProductIssue_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ScanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ScanReport_shop_idx" ON "ScanReport"("shop");

-- CreateIndex
CREATE INDEX "ProductIssue_reportId_idx" ON "ProductIssue"("reportId");
