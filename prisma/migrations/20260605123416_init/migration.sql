-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "syncCount" INTEGER NOT NULL DEFAULT 0,
    "syncResetDate" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BundleRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "bundleProductId" TEXT NOT NULL,
    "bundleVariantId" TEXT NOT NULL,
    "bundleProductTitle" TEXT NOT NULL,
    "bundleSku" TEXT,
    "baseProductId" TEXT NOT NULL,
    "baseVariantId" TEXT NOT NULL,
    "baseProductTitle" TEXT NOT NULL,
    "baseSku" TEXT,
    "baseInventoryItemId" TEXT NOT NULL,
    "multiplier" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BundleRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "bundleRuleId" TEXT,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "bundleVariantId" TEXT NOT NULL,
    "baseVariantId" TEXT NOT NULL,
    "quantitySold" INTEGER NOT NULL,
    "multiplier" INTEGER NOT NULL,
    "totalAdjustment" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SyncLog_bundleRuleId_fkey" FOREIGN KEY ("bundleRuleId") REFERENCES "BundleRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "BundleRule_shopId_idx" ON "BundleRule"("shopId");

-- CreateIndex
CREATE INDEX "BundleRule_bundleVariantId_idx" ON "BundleRule"("bundleVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "BundleRule_shopId_bundleVariantId_key" ON "BundleRule"("shopId", "bundleVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncLog_idempotencyKey_key" ON "SyncLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncLog_shopId_idx" ON "SyncLog"("shopId");

-- CreateIndex
CREATE INDEX "SyncLog_orderId_idx" ON "SyncLog"("orderId");

-- CreateIndex
CREATE INDEX "SyncLog_status_idx" ON "SyncLog"("status");

-- CreateIndex
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");
