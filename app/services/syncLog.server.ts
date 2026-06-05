import db from "../db.server";

export async function createSyncLog(data: {
  shopId: string;
  bundleRuleId: string;
  orderId: string;
  orderName: string;
  bundleVariantId: string;
  baseVariantId: string;
  quantitySold: number;
  multiplier: number;
  totalAdjustment: number;
  status: string;
  errorMessage?: string;
  idempotencyKey: string;
}) {
  return db.syncLog.create({ data });
}

export async function updateSyncLog(id: string, data: {
  status?: string;
  errorMessage?: string;
  processedAt?: Date;
}) {
  return db.syncLog.update({ where: { id }, data });
}

export async function getSyncLogs(shopDomain: string, options?: {
  page?: number;
  limit?: number;
  status?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return { logs: [], total: 0 };

  const page = options?.page || 1;
  const limit = options?.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = { shopId: shop.id };
  if (options?.status) where.status = options.status;
  if (options?.startDate || options?.endDate) {
    where.createdAt = {};
    if (options?.startDate) where.createdAt.gte = options.startDate;
    if (options?.endDate) where.createdAt.lte = options.endDate;
  }

  const [logs, total] = await Promise.all([
    db.syncLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { bundleRule: true },
    }),
    db.syncLog.count({ where }),
  ]);

  return { logs, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getSyncStats(shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return { totalSyncs: 0, successfulSyncs: 0, failedSyncs: 0, currentMonthSyncs: 0 };

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalSyncs, successfulSyncs, failedSyncs, currentMonthSyncs] = await Promise.all([
    db.syncLog.count({ where: { shopId: shop.id } }),
    db.syncLog.count({ where: { shopId: shop.id, status: "success" } }),
    db.syncLog.count({ where: { shopId: shop.id, status: "failed" } }),
    db.syncLog.count({
      where: {
        shopId: shop.id,
        status: "success",
        createdAt: { gte: startOfMonth },
      },
    }),
  ]);

  return { totalSyncs, successfulSyncs, failedSyncs, currentMonthSyncs };
}

export async function getSyncLogByIdempotencyKey(key: string) {
  return db.syncLog.findUnique({ where: { idempotencyKey: key } });
}
