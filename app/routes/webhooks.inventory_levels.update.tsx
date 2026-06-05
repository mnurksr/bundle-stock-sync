import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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

  // 1. Find the Variant ID for this Inventory Item
  const variantResponse = await admin.graphql(
    `#graphql
    query getVariantForInventoryItem($id: ID!) {
      inventoryItem(id: $id) {
        variant {
          id
        }
      }
    }`,
    {
      variables: { id: gidInventoryItemId },
    }
  );

  const variantData = await variantResponse.json();
  const variantId = variantData.data?.inventoryItem?.variant?.id;

  if (!variantId) {
    // Inventory item doesn't belong to a variant or is deleted
    return new Response();
  }

  // 2. Check if this variant is a BASE product in any bundle rules
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return new Response();

  const rules = await db.bundleRule.findMany({
    where: {
      shopId: shop.id,
      baseVariantId: variantId,
    },
  });

  if (rules.length === 0) {
    // This product is not a base product for any bundle, ignore it.
    return new Response();
  }

  // 3. Update the stock for each connected bundle product
  for (const rule of rules) {
    const newBundleStock = Math.max(0, Math.floor(newAvailableCount / rule.multiplier));

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

      if (!bundleInventoryItemId) continue;

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
              ignoreCompareQuantity: true,
              quantities: [
                {
                  inventoryItemId: bundleInventoryItemId,
                  locationId: gidLocationId,
                  quantity: newBundleStock,
                },
              ],
            },
          },
        }
      );

      const setStockData = await setStockResponse.json();
      
      if (setStockData.data?.inventorySetQuantities?.userErrors?.length > 0) {
        console.error("Failed to sync up bundle stock:", setStockData.data.inventorySetQuantities.userErrors);
      } else {
        console.log(`Successfully synced UP bundle stock for rule ${rule.id} to ${newBundleStock} (Available)`);
      }
    } catch (error) {
      console.error(`Error processing up-sync for rule ${rule.id}:`, error);
    }
  }

  return new Response();
};
