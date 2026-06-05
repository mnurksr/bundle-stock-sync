import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { adjustInventory, getLocations } from "../services/inventory.server";
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

  // We need admin API access. For webhook handlers, we use the offline token.
  // The session from authenticate.webhook should have the access token.
  // We'll construct the admin client manually.
  const accessToken = session?.accessToken;
  if (!accessToken) {
    console.log(`[Error] No access token available for ${shopDomain}`);
    return;
  }

  // Simple GraphQL client using fetch
  const adminGraphql = async (query: string, options?: { variables?: Record<string, any> }) => {
    // Note: It's safer to use a stable API version instead of 2026-04 which might not exist
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

  // Get locations for inventory adjustment
  let locations: Array<{ id: string; name: string }> = [];
  try {
    locations = await getLocations(admin as any);
  } catch (error) {
    console.log(`[Error] Failed to get locations for ${shopDomain}:`, error);
    return;
  }

  if (locations.length === 0) {
    console.log(`[Error] No locations found for ${shopDomain}`);
    return;
  }

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

    console.log(`Rule matched! Bundle: ${rule.bundleProductTitle}, Base: ${rule.baseProductTitle}, Multiplier: ${rule.multiplier}`);

    const quantity = lineItem.quantity || 1;
    const totalAdjustment = quantity * rule.multiplier;
    const idempotencyKey = `order-${payload.id}-line-${lineItem.id}-rule-${rule.id}`;

    // Check for duplicate processing
    const existingLog = await getSyncLogByIdempotencyKey(idempotencyKey);
    if (existingLog) {
      console.log(`Already processed: ${idempotencyKey}, skipping`);
      continue;
    }

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
        baseVariantId: rule.baseVariantId,
        quantitySold: quantity,
        multiplier: rule.multiplier,
        totalAdjustment,
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
      baseVariantId: rule.baseVariantId,
      quantitySold: quantity,
      multiplier: rule.multiplier,
      totalAdjustment,
      status: "pending",
      idempotencyKey,
    });

    try {
      // Adjust inventory at each location
      // For simplicity, we adjust at the first (primary) location
      // In a more advanced version, you could adjust at the specific fulfillment location
      const primaryLocation = locations[0];

      await adjustInventory(
        admin,
        rule.baseInventoryItemId,
        primaryLocation.id,
        -totalAdjustment, // Negative delta to decrease stock
        "correction"
      );

      // Update sync log to success
      await updateSyncLog(syncLog.id, {
        status: "success",
        processedAt: new Date(),
      });

      // Increment sync count for quota tracking
      await incrementSyncCount(shopDomain);

      console.log(`✅ Stock adjusted for ${shopDomain}: ${rule.bundleProductTitle} x${quantity} → ${rule.baseProductTitle} -${totalAdjustment}`);
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
