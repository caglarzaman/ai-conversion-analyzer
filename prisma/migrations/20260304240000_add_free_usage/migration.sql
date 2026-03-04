-- CreateTable
CREATE TABLE "FreeUsage" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "month" TEXT NOT NULL,
    "analyses" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);
