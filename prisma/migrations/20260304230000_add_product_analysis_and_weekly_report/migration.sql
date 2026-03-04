-- CreateTable
CREATE TABLE "ProductAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "conversionScore" INTEGER NOT NULL,
    "seoScore" INTEGER NOT NULL,
    "topIssue" TEXT NOT NULL,
    "quickFix" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "weekOf" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "ProductAnalysis_shop_productId_key" ON "ProductAnalysis"("shop", "productId");

-- CreateIndex
CREATE INDEX "ProductAnalysis_shop_idx" ON "ProductAnalysis"("shop");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "WeeklyReport_shop_weekOf_key" ON "WeeklyReport"("shop", "weekOf");

-- CreateIndex
CREATE INDEX "WeeklyReport_shop_idx" ON "WeeklyReport"("shop");
