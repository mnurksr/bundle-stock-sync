import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { adjustInventory, getLocations, getInventoryLocations } from "../services/inventory.server";
import { checkQuota, incrementSyncCount } from "../services/quota.server";
import { createSyncLog, updateSyncLog, getSyncLogByIdempotencyKey } from "../services/syncLog.server";
import { v4 as uuidv4 } from "uuid";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic, session } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!payload || !shop) {
    return new Response("Invalid webhook", { status: 400 });
  }

  // Process asynchronously but respond quickly
  // In a production app with high volume, you'd queue this
  try {
    await processOrderPaid(shop, payload, session);
  } catch (error) {
    console.log(`[Error] Error processing orders/paid webhook for ${shop}:`, error);
    // Still return 200 to prevent Shopify from retrying
  }

  return new Response();
};

async function processOrderPaid(shopDomain: string, payload: any, session: any) {
  const orderId = `gid://shopify/Order/${payload.id}`;
  const orderName = payload.name || `#${payload.order_number}`;
  const lineItems = payload.line_items || [];

  // Get shop from DB
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop || !shop.isActive) {
    console.log(`Shop ${shopDomain} not found or inactive, skipping`);
    return;
  }

  // Get all active bundle rules for this shop
  const bundleRules = await db.bundleRule.findMany({
    where: { shopId: shop.id, isActive: true },
    include: { items: true },
  });

  if (bundleRules.length === 0) {
    console.log(`No active bundle rules for ${shopDomain}, skipping`);
    return;
  }

  // Create a lookup map: variantId -> bundleRule
  const ruleMap = new Map<string, typeof bundleRules[0]>();
  for (const rule of bundleRules) {
    // Store with both GID and numeric ID for matching
    const numericId = rule.bundleVariantId.replace("gid://shopify/ProductVariant/", "");
    ruleMap.set(rule.bundleVariantId, rule);
    ruleMap.set(numericId, rule);
  }

  // Get session for API calls
  if (!session) {
    const sessions = await db.session.findMany({ where: { shop: shopDomain } });
    const offlineSession = sessions.find(s => !s.isOnline);
    if (!offlineSession) {
      console.log(`[Error] No offline session found for ${shopDomain}`);
      return;
    }
    session = offlineSession;
  }

  // We need admin API access.
  const accessToken = session?.accessToken;
  if (!accessToken) {
    console.log(`[Error] No access token available for ${shopDomain}`);
    return;
  }

  // Simple GraphQL client using fetch
  const adminGraphql = async (query: string, options?: { variables?: Record<string, any> }) => {
    const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query,
        variables: options?.variables,
      }),
    });
    return {
      json: () => response.json(),
    };
  };

  const admin = { graphql: adminGraphql };


  console.log(`Processing ${lineItems.length} line items for order ${orderId}`);

  // Process each line item
  for (const lineItem of lineItems) {
    const variantId = String(lineItem.variant_id);
    const gidVariantId = `gid://shopify/ProductVariant/${variantId}`;
    
    console.log(`Checking line item: ${lineItem.title} (Variant ID: ${variantId})`);

    // Check if this variant matches a bundle rule
    const rule = ruleMap.get(variantId) || ruleMap.get(gidVariantId);
    if (!rule) {
      console.log(`No rule found for variant ${variantId}, skipping.`);
      continue;
    }

    console.log(`Rule matched! Bundle: ${rule.bundleProductTitle}, Items: ${rule.items.length}`);

    const quantitySold = lineItem.quantity || 1;
    const idempotencyKey = `order-${payload.id}-line-${lineItem.id}-rule-${rule.id}`;

    // Check for duplicate processing
    const existingLog = await getSyncLogByIdempotencyKey(idempotencyKey);
    if (existingLog) {
      console.log(`Already processed: ${idempotencyKey}, skipping`);
      continue;
    }
    
    // Prepare items summary for log
    const itemsSummaryArray = rule.items.map(item => ({
      baseVariantId: item.baseVariantId,
      title: item.baseProductTitle,
      quantitySold,
      multiplier: item.quantity,
      totalAdjustment: quantitySold * item.quantity
    }));
    const itemsSummary = JSON.stringify(itemsSummaryArray);

    // Check quota
    const quotaCheck = await checkQuota(shopDomain);
    if (!quotaCheck.allowed) {
      console.log(`Quota exceeded for ${shopDomain} (${quotaCheck.used}/${quotaCheck.limit})`);
      await createSyncLog({
        shopId: shop.id,
        bundleRuleId: rule.id,
        orderId,
        orderName,
        bundleVariantId: rule.bundleVariantId,
        itemsSummary,
        status: "skipped",
        errorMessage: `Free plan quota exceeded (${quotaCheck.used}/${quotaCheck.limit}). Upgrade to Pro for unlimited syncs.`,
        idempotencyKey,
      });
      continue;
    }

    // Create pending sync log
    const syncLog = await createSyncLog({
      shopId: shop.id,
      bundleRuleId: rule.id,
      orderId,
      orderName,
      bundleVariantId: rule.bundleVariantId,
      itemsSummary,
      status: "pending",
      idempotencyKey,
    });

    try {
      // Adjust inventory for each base item in the bundle
      for (const item of rule.items) {
        const totalAdjustment = quantitySold * item.quantity;
        
        // Find best location to deduct from (where the item is actually stocked)
        const itemLocations = await getInventoryLocations(admin as any, item.baseInventoryItemId);
        
        if (itemLocations.length === 0) {
          throw new Error(`Inventory item is not stocked at any location.`);
        }
        
        // Prefer location with enough stock, otherwise just pick the first one where it is stocked
        let targetLocation = itemLocations.find(l => l.available >= totalAdjustment) || itemLocations[0];

        await adjustInventory(
          admin as any,
          item.baseInventoryItemId,
          targetLocation.locationId,
          -totalAdjustment, // Negative delta to decrease stock
          "correction"
        );
        console.log(`✅ Stock adjusted for ${shopDomain}: ${rule.bundleProductTitle} x${quantitySold} → ${item.baseProductTitle} -${totalAdjustment} at ${targetLocation.locationId}`);
      }

      // Update sync log to success
      await updateSyncLog(syncLog.id, {
        status: "success",
        processedAt: new Date(),
      });

      // Increment sync count for quota tracking
      await incrementSyncCount(shopDomain);

    } catch (error: any) {
      console.error(`❌ Failed to adjust stock for ${shopDomain}:`, error);
      await updateSyncLog(syncLog.id, {
        status: "failed",
        errorMessage: error.message || "Unknown error",
        processedAt: new Date(),
      });
    }
  }
}
