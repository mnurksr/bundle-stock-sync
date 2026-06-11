import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { createSyncLog } from "../services/syncLog.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, admin } = await authenticate.webhook(request);

  if (!admin) {
    // The admin context isn't available if the shop is inactive
    return new Response();
  }

  const shopDomain = session.shop;

  // Payload looks like:
  // {
  //   "inventory_item_id": 808950810,
  //   "location_id": 905684977,
  //   "available": 5,
  //   "updated_at": "2020-04-04T12:00:00-04:00"
  // }
  const inventoryItemIdNumber = payload.inventory_item_id;
  const locationIdNumber = payload.location_id;
  const newAvailableCount = payload.available;

  if (!inventoryItemIdNumber || !locationIdNumber || typeof newAvailableCount !== "number") {
    return new Response();
  }

  const gidInventoryItemId = `gid://shopify/InventoryItem/${inventoryItemIdNumber}`;
  const gidLocationId = `gid://shopify/Location/${locationIdNumber}`;

  // 2. Check if this inventory item is a BASE product in any bundle rules
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return new Response();

  // Check if auto-adjust is enabled for this shop
  if (!shop.autoAdjustBundleStock) {
    return new Response();
  }

  // LOG: Webhook Received
  await createSyncLog({
    shopId: shop.id,
    orderId: `webhook-trace-${Date.now()}`,
    orderName: "Diagnostic: Webhook Received",
    bundleVariantId: "trace",
    status: "success",
    errorMessage: `Received inventory_item_id: ${inventoryItemIdNumber}, location: ${locationIdNumber}, available: ${newAvailableCount}`,
    idempotencyKey: `trace-1-${Date.now()}`
  });

  const rules = await db.bundleRule.findMany({
    where: {
      shopId: shop.id,
      items: {
        some: {
          baseInventoryItemId: gidInventoryItemId,
        }
      }
    },
    include: { items: true }
  });

  if (rules.length === 0) {
    // LOG: No Rules Found
    await createSyncLog({
      shopId: shop.id,
      orderId: `webhook-trace-${Date.now()}`,
      orderName: "Diagnostic: No Rules Found",
      bundleVariantId: "trace",
      status: "success",
      errorMessage: `Could not find any bundle rule containing inventory_item_id: ${gidInventoryItemId}`,
      idempotencyKey: `trace-2-${Date.now()}`
    });
    return new Response();
  }
  
  // LOG: Rules Found
  await createSyncLog({
    shopId: shop.id,
    orderId: `webhook-trace-${Date.now()}`,
    orderName: "Diagnostic: Rules Found",
    bundleVariantId: "trace",
    status: "success",
    errorMessage: `Found ${rules.length} rule(s) for this item. Proceeding to calculate stock.`,
    idempotencyKey: `trace-3-${Date.now()}`
  });

  // 3. Update the stock for each connected bundle product
  for (const rule of rules) {
    let maxPossibleBundles = Infinity;
    
    // Calculate bottleneck across all items
    for (const item of rule.items) {
      let stockForThisItem = 0;
      
      if (item.baseInventoryItemId === gidInventoryItemId) {
        stockForThisItem = newAvailableCount;
      } else {
        // Fetch from Shopify
        try {
          const stockResponse = await admin.graphql(
            `#graphql
            query getInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
              inventoryItem(id: $inventoryItemId) {
                inventoryLevel(locationId: $locationId) {
                  quantities(names: ["available"]) {
                    quantity
                  }
                }
              }
            }`,
            {
              variables: {
                inventoryItemId: item.baseInventoryItemId,
                locationId: gidLocationId,
              },
            }
          );
          const stockData = await stockResponse.json();
          stockForThisItem = stockData.data?.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity || 0;
        } catch (error) {
          await createSyncLog({
            shopId: shop.id,
            bundleRuleId: rule.id,
            orderId: `webhook-trace-${Date.now()}`,
            orderName: "Diagnostic: Sibling Fetch Crash",
            bundleVariantId: rule.bundleVariantId,
            status: "failed",
            errorMessage: `Failed to fetch sibling stock: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
            idempotencyKey: `trace-sibling-crash-${item.id}-${Date.now()}`
          });
          console.error(`Failed to fetch stock for sibling item ${item.baseProductTitle}:`, error);
          stockForThisItem = 0; // Assume 0 if fetch fails to prevent overselling
        }
      }
      
      const possibleBundlesWithThisItem = Math.floor(stockForThisItem / item.quantity);
      if (possibleBundlesWithThisItem < maxPossibleBundles) {
        maxPossibleBundles = possibleBundlesWithThisItem;
      }
    }
    
    const newBundleStock = Math.max(0, maxPossibleBundles);

    try {
      // Find the bundle product's inventory item id
      const bundleVariantResponse = await admin.graphql(
        `#graphql
        query getBundleVariantInventory($id: ID!) {
          productVariant(id: $id) {
            inventoryItem {
              id
            }
          }
        }`,
        {
          variables: { id: rule.bundleVariantId },
        }
      );

      const bundleVariantData = await bundleVariantResponse.json();
      const bundleInventoryItemId = bundleVariantData.data?.productVariant?.inventoryItem?.id;

      if (!bundleInventoryItemId) {
        await createSyncLog({
          shopId: shop.id,
          bundleRuleId: rule.id,
          orderId: `webhook-trace-${Date.now()}`,
          orderName: "Diagnostic: Bundle Inventory Item Missing",
          bundleVariantId: rule.bundleVariantId,
          status: "failed",
          errorMessage: `Could not find inventory item ID for bundle variant: ${rule.bundleVariantId}. Check if the variant was deleted.`,
          idempotencyKey: `trace-missing-inv-${rule.id}-${Date.now()}`
        });
        continue;
      }

      await createSyncLog({
        shopId: shop.id,
        bundleRuleId: rule.id,
        orderId: `webhook-trace-${Date.now()}`,
        orderName: "Diagnostic: About to compare stocks",
        bundleVariantId: rule.bundleVariantId,
        status: "success",
        errorMessage: `Calculated new max bundles: ${newBundleStock}. Proceeding to fetch current bundle stock...`,
        idempotencyKey: `trace-compare-${rule.id}-${Date.now()}`
      });

      // Check current bundle stock at this location to prevent ECHO logs
      const bundleInventoryResponse = await admin.graphql(
        `#graphql
        query getInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
          inventoryItem(id: $inventoryItemId) {
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) {
                quantity
              }
            }
          }
        }`,
        {
          variables: {
            inventoryItemId: bundleInventoryItemId,
            locationId: gidLocationId,
          },
        }
      );

      const bundleInventoryData = await bundleInventoryResponse.json();
      const currentBundleStock = bundleInventoryData.data?.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity || 0;

      if (currentBundleStock === newBundleStock) {
        await createSyncLog({
          shopId: shop.id,
          bundleRuleId: rule.id,
          orderId: `webhook-trace-${Date.now()}`,
          orderName: "Diagnostic: Echo Prevented",
          bundleVariantId: rule.bundleVariantId,
          status: "success",
          errorMessage: `Calculated new stock is ${newBundleStock}, and current stock is already ${currentBundleStock}. Skipping API call.`,
          idempotencyKey: `trace-echo-${rule.id}-${Date.now()}`
        });
        continue;
      }

      await createSyncLog({
        shopId: shop.id,
        bundleRuleId: rule.id,
        orderId: `webhook-trace-${Date.now()}`,
        orderName: "Diagnostic: Updating Stock",
        bundleVariantId: rule.bundleVariantId,
        status: "success",
        errorMessage: `Current stock is ${currentBundleStock}, new stock should be ${newBundleStock}. Executing mutation...`,
        idempotencyKey: `trace-mutate-${rule.id}-${Date.now()}`
      });

      // SET the absolute stock for the bundle product at the same location targeting "available" directly
      const setStockResponse = await admin.graphql(
        `#graphql
        mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            inventoryAdjustmentGroup {
              createdAt
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: {
              name: "available",
              reason: "correction",
              quantities: [
                {
                  inventoryItemId: bundleInventoryItemId,
                  locationId: gidLocationId,
                  quantity: newBundleStock,
                  compareQuantity: currentBundleStock,
                },
              ],
            },
          },
        }
      );

      const setStockData = await setStockResponse.json();
      
      const itemsSummaryArray = rule.items.map(item => ({
        baseVariantId: item.baseVariantId,
        title: item.baseProductTitle,
        quantitySold: 0,
        multiplier: item.quantity,
        totalAdjustment: 0
      }));
      const itemsSummary = JSON.stringify(itemsSummaryArray);
      
      if (setStockData.data?.inventorySetQuantities?.userErrors?.length > 0) {
        console.error("Failed to sync up bundle stock:", setStockData.data.inventorySetQuantities.userErrors);
        
        await createSyncLog({
          shopId: shop.id,
          orderId: `inventory-${payload.updated_at || Date.now()}`,
          orderName: "Up-Sync Error",
          bundleRuleId: rule.id,
          bundleVariantId: rule.bundleVariantId,
          itemsSummary,
          status: "failed",
          errorMessage: `Error: ${JSON.stringify(setStockData.data.inventorySetQuantities.userErrors)}`,
          idempotencyKey: `up-sync-${rule.id}-${payload.updated_at || Date.now()}`
        });

      } else {
        console.log(`Successfully synced UP bundle stock for rule ${rule.id} to ${newBundleStock} (Available)`);
        
        // --- VISUAL ECHO PREVENTER ---
        const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000);
        const recentOrderLog = await db.syncLog.findFirst({
          where: {
            shopId: shop.id,
            bundleRuleId: rule.id,
            orderName: { notIn: ["Base Stock Changed", "Auto Up-Sync", "Up-Sync Error"] },
            createdAt: { gte: fifteenSecondsAgo }
          }
        });

        if (recentOrderLog) {
          console.log(`[Up-Sync] Suppressing log because Order ${recentOrderLog.orderName} just occurred.`);
        } else {
          await createSyncLog({
            shopId: shop.id,
            orderId: `inventory-${payload.updated_at || Date.now()}`,
            orderName: "Base Stock Changed",
            bundleRuleId: rule.id,
            bundleVariantId: rule.bundleVariantId,
            itemsSummary,
            status: "success",
            errorMessage: `Bundle stock updated to: ${newBundleStock}`,
            idempotencyKey: `up-sync-${rule.id}-${payload.updated_at || Date.now()}`
          });
        }
      }
    } catch (error) {
      await createSyncLog({
        shopId: shop.id,
        bundleRuleId: rule.id,
        orderId: `webhook-trace-${Date.now()}`,
        orderName: "Diagnostic: Critical Crash",
        bundleVariantId: rule.bundleVariantId,
        status: "failed",
        errorMessage: `CRASH in webhook: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        idempotencyKey: `trace-crash-${rule.id}-${Date.now()}`
      });
      console.error(`Error processing up-sync for rule ${rule.id}:`, error);
    }
  }

  return new Response();
};
