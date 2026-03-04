-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GeneratedDescription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_shop_month_key" ON "AiUsage"("shop", "month");

-- CreateIndex
CREATE INDEX "AiUsage_shop_idx" ON "AiUsage"("shop");

-- CreateIndex
CREATE INDEX "GeneratedDescription_shop_idx" ON "GeneratedDescription"("shop");

-- CreateIndex
CREATE INDEX "GeneratedDescription_productId_idx" ON "GeneratedDescription"("productId");
