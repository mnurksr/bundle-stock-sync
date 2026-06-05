import db from "../db.server";

export async function getBundleRules(shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return [];
  return db.bundleRule.findMany({
    where: { shopId: shop.id, isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAllBundleRules(shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return [];
  return db.bundleRule.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });
}

export async function getBundleRuleById(id: string, shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return null;
  return db.bundleRule.findFirst({
    where: { id, shopId: shop.id },
  });
}

export async function getBundleRuleByVariantId(bundleVariantId: string, shopId: string) {
  return db.bundleRule.findUnique({
    where: {
      shopId_bundleVariantId: {
        shopId,
        bundleVariantId,
      },
    },
  });
}

export async function createBundleRule(data: {
  shopDomain: string;
  bundleProductId: string;
  bundleVariantId: string;
  bundleProductTitle: string;
  bundleSku?: string;
  baseProductId: string;
  baseVariantId: string;
  baseProductTitle: string;
  baseSku?: string;
  baseInventoryItemId: string;
  multiplier: number;
}) {
  // Ensure shop exists
  let shop = await db.shop.findUnique({ where: { shopDomain: data.shopDomain } });
  if (!shop) {
    shop = await db.shop.create({
      data: { shopDomain: data.shopDomain },
    });
  }

  return db.bundleRule.create({
    data: {
      shopId: shop.id,
      bundleProductId: data.bundleProductId,
      bundleVariantId: data.bundleVariantId,
      bundleProductTitle: data.bundleProductTitle,
      bundleSku: data.bundleSku || null,
      baseProductId: data.baseProductId,
      baseVariantId: data.baseVariantId,
      baseProductTitle: data.baseProductTitle,
      baseSku: data.baseSku || null,
      baseInventoryItemId: data.baseInventoryItemId,
      multiplier: data.multiplier,
    },
  });
}

export async function updateBundleRule(id: string, shopDomain: string, data: {
  multiplier?: number;
  isActive?: boolean;
  bundleProductTitle?: string;
  baseProductTitle?: string;
}) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error("Shop not found");
  
  return db.bundleRule.updateMany({
    where: { id, shopId: shop.id },
    data,
  });
}

export async function deleteBundleRule(id: string, shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error("Shop not found");
  
  return db.bundleRule.deleteMany({
    where: { id, shopId: shop.id },
  });
}
