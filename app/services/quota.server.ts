import db from "../db.server";

const FREE_PLAN_LIMIT = 50;

export async function getOrCreateShop(shopDomain: string) {
  let shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    shop = await db.shop.create({
      data: { shopDomain },
    });
  }
  return shop;
}

export async function checkQuota(shopDomain: string): Promise<{
  allowed: boolean;
  plan: string;
  used: number;
  limit: number | null;
  remaining: number | null;
}> {
  const shop = await getOrCreateShop(shopDomain);

  if (shop.plan === "pro") {
    return {
      allowed: true,
      plan: "pro",
      used: shop.syncCount,
      limit: null, // unlimited
      remaining: null,
    };
  }

  // Free plan - check monthly quota
  await resetQuotaIfNeeded(shop.id, shop.syncResetDate);
  
  // Re-fetch after potential reset
  const updatedShop = await db.shop.findUnique({ where: { id: shop.id } });
  const used = updatedShop?.syncCount || 0;

  return {
    allowed: used < FREE_PLAN_LIMIT,
    plan: "free",
    used,
    limit: FREE_PLAN_LIMIT,
    remaining: Math.max(0, FREE_PLAN_LIMIT - used),
  };
}

export async function incrementSyncCount(shopDomain: string) {
  const shop = await getOrCreateShop(shopDomain);
  await resetQuotaIfNeeded(shop.id, shop.syncResetDate);
  
  return db.shop.update({
    where: { id: shop.id },
    data: { syncCount: { increment: 1 } },
  });
}

export async function getQuotaInfo(shopDomain: string) {
  return checkQuota(shopDomain);
}

async function resetQuotaIfNeeded(shopId: string, syncResetDate: Date | null) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (!syncResetDate || syncResetDate < startOfMonth) {
    await db.shop.update({
      where: { id: shopId },
      data: {
        syncCount: 0,
        syncResetDate: startOfMonth,
      },
    });
  }
}

export async function upgradeToPro(shopDomain: string) {
  return db.shop.update({
    where: { shopDomain },
    data: { plan: "pro" },
  });
}

export async function downgradeToFree(shopDomain: string) {
  return db.shop.update({
    where: { shopDomain },
    data: { plan: "free" },
  });
}
