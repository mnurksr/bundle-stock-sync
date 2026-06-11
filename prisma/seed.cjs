const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const shop = await prisma.shop.findFirst();
  if (!shop) {
    console.log("No shop found in DB, please visit the app first to create the shop record.");
    return;
  }

  // Delete all existing rules and logs for this shop
  await prisma.bundleRule.deleteMany({ where: { shopId: shop.id } });
  await prisma.syncLog.deleteMany({ where: { shopId: shop.id } });

  // Create Mock Bundle Rules
  const rule1 = await prisma.bundleRule.create({
    data: {
      shopId: shop.id,
      bundleProductId: "gid://shopify/Product/111111",
      bundleVariantId: "gid://shopify/ProductVariant/111111",
      bundleProductTitle: "Winter Sports Starter Kit",
      bundleSku: "WINTER-KIT",
      isActive: true,
      items: {
        create: [
          {
            baseProductId: "gid://shopify/Product/222222",
            baseVariantId: "gid://shopify/ProductVariant/222222",
            baseProductTitle: "The Collection Snowboard: Hydrogen",
            baseSku: "SNOW-HYD",
            baseInventoryItemId: "gid://shopify/InventoryItem/222222",
            quantity: 1,
          },
          {
            baseProductId: "gid://shopify/Product/333333",
            baseVariantId: "gid://shopify/ProductVariant/333333",
            baseProductTitle: "Snowboard Boots (Size 42)",
            baseSku: "BOOT-42",
            baseInventoryItemId: "gid://shopify/InventoryItem/333333",
            quantity: 1,
          }
        ]
      }
    }
  });

  const rule2 = await prisma.bundleRule.create({
    data: {
      shopId: shop.id,
      bundleProductId: "gid://shopify/Product/444444",
      bundleVariantId: "gid://shopify/ProductVariant/444444",
      bundleProductTitle: "Energy Drink 12-Pack",
      bundleSku: "NRG-12",
      isActive: true,
      items: {
        create: [
          {
            baseProductId: "gid://shopify/Product/555555",
            baseVariantId: "gid://shopify/ProductVariant/555555",
            baseProductTitle: "Energy Drink (Single Can)",
            baseSku: "NRG-SINGLE",
            baseInventoryItemId: "gid://shopify/InventoryItem/555555",
            quantity: 12,
          }
        ]
      }
    }
  });

  const rule3 = await prisma.bundleRule.create({
    data: {
      shopId: shop.id,
      bundleProductId: "gid://shopify/Product/666666",
      bundleVariantId: "gid://shopify/ProductVariant/666666",
      bundleProductTitle: "Gaming Setup Combo",
      bundleSku: "GAME-COMBO",
      isActive: true,
      items: {
        create: [
          {
            baseProductId: "gid://shopify/Product/777777",
            baseVariantId: "gid://shopify/ProductVariant/777777",
            baseProductTitle: "Mechanical Keyboard RGB",
            baseSku: "KEY-RGB",
            baseInventoryItemId: "gid://shopify/InventoryItem/777777",
            quantity: 1,
          },
          {
            baseProductId: "gid://shopify/Product/888888",
            baseVariantId: "gid://shopify/ProductVariant/888888",
            baseProductTitle: "Wireless Gaming Mouse",
            baseSku: "MOUSE-WRLS",
            baseInventoryItemId: "gid://shopify/InventoryItem/888888",
            quantity: 1,
          },
          {
            baseProductId: "gid://shopify/Product/999999",
            baseVariantId: "gid://shopify/ProductVariant/999999",
            baseProductTitle: "Extra Large Mousepad",
            baseSku: "PAD-XL",
            baseInventoryItemId: "gid://shopify/InventoryItem/999999",
            quantity: 1,
          }
        ]
      }
    }
  });

  // Create Mock Sync Logs
  await prisma.syncLog.create({
    data: {
      shopId: shop.id,
      bundleRuleId: rule1.id,
      orderId: "gid://shopify/Order/1001",
      orderName: "#1001",
      bundleVariantId: rule1.bundleVariantId,
      status: "success",
      idempotencyKey: "mock-1001",
      processedAt: new Date(Date.now() - 1000 * 60 * 5),
      createdAt: new Date(Date.now() - 1000 * 60 * 5),
      itemsSummary: JSON.stringify([
        { title: "The Collection Snowboard: Hydrogen", quantitySold: 1, multiplier: 1, totalAdjustment: 1 },
        { title: "Snowboard Boots (Size 42)", quantitySold: 1, multiplier: 1, totalAdjustment: 1 }
      ])
    }
  });

  await prisma.syncLog.create({
    data: {
      shopId: shop.id,
      bundleRuleId: rule2.id,
      orderId: "gid://shopify/Order/1002",
      orderName: "#1002",
      bundleVariantId: rule2.bundleVariantId,
      status: "success",
      idempotencyKey: "mock-1002",
      processedAt: new Date(Date.now() - 1000 * 60 * 120),
      createdAt: new Date(Date.now() - 1000 * 60 * 120),
      itemsSummary: JSON.stringify([
        { title: "Energy Drink (Single Can)", quantitySold: 2, multiplier: 12, totalAdjustment: 24 }
      ])
    }
  });

  await prisma.syncLog.create({
    data: {
      shopId: shop.id,
      bundleRuleId: rule1.id,
      orderId: "gid://shopify/Order/1003",
      orderName: "#1003",
      bundleVariantId: rule1.bundleVariantId,
      status: "failed",
      errorMessage: "Insufficient inventory for base item: Snowboard Boots (Size 42)",
      idempotencyKey: "mock-1003",
      processedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      itemsSummary: JSON.stringify([
        { title: "The Collection Snowboard: Hydrogen", quantitySold: 1, multiplier: 1, totalAdjustment: 1 },
        { title: "Snowboard Boots (Size 42)", quantitySold: 1, multiplier: 1, totalAdjustment: 1 }
      ])
    }
  });

  await prisma.syncLog.create({
    data: {
      shopId: shop.id,
      bundleRuleId: rule3.id,
      orderId: "gid://shopify/Order/1004",
      orderName: "#1004",
      bundleVariantId: rule3.bundleVariantId,
      status: "success",
      idempotencyKey: "mock-1004",
      processedAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
      itemsSummary: JSON.stringify([
        { title: "Mechanical Keyboard RGB", quantitySold: 1, multiplier: 1, totalAdjustment: 1 },
        { title: "Wireless Gaming Mouse", quantitySold: 1, multiplier: 1, totalAdjustment: 1 },
        { title: "Extra Large Mousepad", quantitySold: 1, multiplier: 1, totalAdjustment: 1 }
      ])
    }
  });

  // Base Stock Changed (Up-Sync)
  await prisma.syncLog.create({
    data: {
      shopId: shop.id,
      bundleRuleId: null,
      orderId: "gid://shopify/InventoryLevel/777",
      orderName: "Base Stock Changed",
      bundleVariantId: "multiple",
      status: "success",
      idempotencyKey: "mock-1005",
      processedAt: new Date(Date.now() - 1000 * 60 * 30),
      createdAt: new Date(Date.now() - 1000 * 60 * 30),
      itemsSummary: JSON.stringify([])
    }
  });

  // Update shop sync count
  await prisma.shop.update({
    where: { id: shop.id },
    data: { syncCount: 4 }
  });

  console.log("Mock data seeded successfully.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
