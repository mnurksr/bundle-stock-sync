import db from "../db.server";

export async function getBundleRules(shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return [];
  return db.bundleRule.findMany({
    where: { shopId: shop.id, isActive: true },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });
}

export async function getAllBundleRules(shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return [];
  return db.bundleRule.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });
}

export async function getBundleRuleById(id: string, shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return null;
  return db.bundleRule.findFirst({
    where: { id, shopId: shop.id },
    include: { items: true },
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
    include: { items: true },
  });
}

export async function deleteBundleRule(id: string, shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error("Shop not found");
  
  return db.bundleRule.deleteMany({
    where: { id, shopId: shop.id },
  });
}
