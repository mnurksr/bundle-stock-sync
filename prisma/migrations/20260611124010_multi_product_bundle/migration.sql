/*
  Warnings:

  - You are about to drop the column `baseInventoryItemId` on the `BundleRule` table. All the data in the column will be lost.
  - You are about to drop the column `baseProductId` on the `BundleRule` table. All the data in the column will be lost.
  - You are about to drop the column `baseProductTitle` on the `BundleRule` table. All the data in the column will be lost.
  - You are about to drop the column `baseSku` on the `BundleRule` table. All the data in the column will be lost.
  - You are about to drop the column `baseVariantId` on the `BundleRule` table. All the data in the column will be lost.
  - You are about to drop the column `multiplier` on the `BundleRule` table. All the data in the column will be lost.
  - You are about to drop the column `baseVariantId` on the `SyncLog` table. All the data in the column will be lost.
  - You are about to drop the column `multiplier` on the `SyncLog` table. All the data in the column will be lost.
  - You are about to drop the column `quantitySold` on the `SyncLog` table. All the data in the column will be lost.
  - You are about to drop the column `totalAdjustment` on the `SyncLog` table. All the data in the column will be lost.
  - Added the required column `itemsSummary` to the `SyncLog` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "BundleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleRuleId" TEXT NOT NULL,
    "baseProductId" TEXT NOT NULL,
    "baseVariantId" TEXT NOT NULL,
    "baseProductTitle" TEXT NOT NULL,
    "baseSku" TEXT,
    "baseInventoryItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BundleItem_bundleRuleId_fkey" FOREIGN KEY ("bundleRuleId") REFERENCES "BundleRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BundleRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "bundleProductId" TEXT NOT NULL,
    "bundleVariantId" TEXT NOT NULL,
    "bundleProductTitle" TEXT NOT NULL,
    "bundleSku" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BundleRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BundleRule" ("bundleProductId", "bundleProductTitle", "bundleSku", "bundleVariantId", "createdAt", "id", "isActive", "shopId", "updatedAt") SELECT "bundleProductId", "bundleProductTitle", "bundleSku", "bundleVariantId", "createdAt", "id", "isActive", "shopId", "updatedAt" FROM "BundleRule";
INSERT INTO "BundleItem" ("id", "bundleRuleId", "baseProductId", "baseVariantId", "baseProductTitle", "baseSku", "baseInventoryItemId", "quantity") SELECT hex(randomblob(12)), "id", "baseProductId", "baseVariantId", "baseProductTitle", "baseSku", "baseInventoryItemId", "multiplier" FROM "BundleRule";
DROP TABLE "BundleRule";
ALTER TABLE "new_BundleRule" RENAME TO "BundleRule";
CREATE INDEX "BundleRule_shopId_idx" ON "BundleRule"("shopId");
CREATE INDEX "BundleRule_bundleVariantId_idx" ON "BundleRule"("bundleVariantId");
CREATE UNIQUE INDEX "BundleRule_shopId_bundleVariantId_key" ON "BundleRule"("shopId", "bundleVariantId");
CREATE TABLE "new_SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "bundleRuleId" TEXT,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "bundleVariantId" TEXT NOT NULL,
    "itemsSummary" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SyncLog_bundleRuleId_fkey" FOREIGN KEY ("bundleRuleId") REFERENCES "BundleRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SyncLog" ("bundleRuleId", "bundleVariantId", "createdAt", "errorMessage", "id", "idempotencyKey", "orderId", "orderName", "processedAt", "shopId", "status") SELECT "bundleRuleId", "bundleVariantId", "createdAt", "errorMessage", "id", "idempotencyKey", "orderId", "orderName", "processedAt", "shopId", "status" FROM "SyncLog";
DROP TABLE "SyncLog";
ALTER TABLE "new_SyncLog" RENAME TO "SyncLog";
CREATE UNIQUE INDEX "SyncLog_idempotencyKey_key" ON "SyncLog"("idempotencyKey");
CREATE INDEX "SyncLog_shopId_idx" ON "SyncLog"("shopId");
CREATE INDEX "SyncLog_orderId_idx" ON "SyncLog"("orderId");
CREATE INDEX "SyncLog_status_idx" ON "SyncLog"("status");
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BundleItem_bundleRuleId_idx" ON "BundleItem"("bundleRuleId");

-- CreateIndex
CREATE INDEX "BundleItem_baseVariantId_idx" ON "BundleItem"("baseVariantId");
