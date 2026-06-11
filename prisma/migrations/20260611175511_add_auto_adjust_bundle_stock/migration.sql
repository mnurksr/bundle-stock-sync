-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "syncCount" INTEGER NOT NULL DEFAULT 0,
    "syncResetDate" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoAdjustBundleStock" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shop" ("createdAt", "id", "installedAt", "isActive", "plan", "shopDomain", "syncCount", "syncResetDate", "uninstalledAt", "updatedAt") SELECT "createdAt", "id", "installedAt", "isActive", "plan", "shopDomain", "syncCount", "syncResetDate", "uninstalledAt", "updatedAt" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
