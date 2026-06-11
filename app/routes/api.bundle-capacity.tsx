import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const bundleVariantId = formData.get("bundleVariantId") as string;
  const itemsStr = formData.get("items") as string;

  if (!bundleVariantId || !itemsStr) {
    return json({ error: "Missing required fields" }, { status: 400 });
  }

  let items: Array<{ baseVariantId: string; quantity: number; title: string }> = [];
  try {
    items = JSON.parse(itemsStr);
  } catch (e) {
    return json({ error: "Invalid items JSON" }, { status: 400 });
  }

  // 1. Get all shop locations
  const locationsRes = await admin.graphql(
    `#graphql
    query getLocations {
      locations(first: 50, includeLegacy: false, includeInactive: false) {
        edges {
          node {
            id
            name
          }
        }
      }
    }`
  );
  const locationsData = await locationsRes.json();
  const allLocations: Array<{ id: string; name: string }> = 
    locationsData.data?.locations?.edges?.map((e: any) => e.node) || [];

  // 2. Get bundle variant's inventory item and its levels per location
  const bundleInvRes = await admin.graphql(
    `#graphql
    query getBundleInventory($variantId: ID!) {
      productVariant(id: $variantId) {
        inventoryItem {
          id
          inventoryLevels(first: 50) {
            edges {
              node {
                location {
                  id
                  name
                }
                quantities(names: ["available"]) {
                  quantity
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { variantId: bundleVariantId } }
  );
  const bundleInvData = await bundleInvRes.json();
  const bundleLevels = bundleInvData.data?.productVariant?.inventoryItem?.inventoryLevels?.edges || [];

  // Map: locationId -> { name, currentBundleStock }
  const bundleLocationMap: Record<string, { name: string; currentStock: number }> = {};
  for (const edge of bundleLevels) {
    const locId = edge.node.location.id;
    const locName = edge.node.location.name;
    const qty = edge.node.quantities?.find((q: any) => q.name === "available")?.quantity ?? 0;
    bundleLocationMap[locId] = { name: locName, currentStock: qty };
  }

  // 3. For each base item, get inventory levels at ALL locations
  const baseItemLevels: Array<{
    title: string;
    quantity: number;
    levels: Record<string, number>; // locationId -> available
  }> = [];

  for (const item of items) {
    const res = await admin.graphql(
      `#graphql
      query getBaseItemInventory($variantId: ID!) {
        productVariant(id: $variantId) {
          inventoryItem {
            inventoryLevels(first: 50) {
              edges {
                node {
                  location {
                    id
                  }
                  quantities(names: ["available"]) {
                    quantity
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { variantId: item.baseVariantId } }
    );
    const data = await res.json();
    const levels = data.data?.productVariant?.inventoryItem?.inventoryLevels?.edges || [];

    const levelMap: Record<string, number> = {};
    for (const edge of levels) {
      const locId = edge.node.location.id;
      const qty = edge.node.quantities?.find((q: any) => q.name === "available")?.quantity ?? 0;
      levelMap[locId] = qty;
    }

    baseItemLevels.push({
      title: item.title,
      quantity: item.quantity,
      levels: levelMap,
    });
  }

  // 4. Calculate per-location capacity
  const locationResults: Array<{
    locationId: string;
    locationName: string;
    maxBundles: number;
    currentBundleStock: number;
    isSafe: boolean;
    items: Array<{
      title: string;
      available: number;
      needed: number;
      possible: number;
      stocked: boolean;
    }>;
    blockers: string[];
  }> = [];

  // Only calculate for locations where the bundle product is stocked
  for (const [locationId, locInfo] of Object.entries(bundleLocationMap)) {
    const locationItems: Array<{
      title: string;
      available: number;
      needed: number;
      possible: number;
      stocked: boolean;
    }> = [];
    const blockers: string[] = [];
    let minPossible = Infinity;

    for (const baseItem of baseItemLevels) {
      const available = baseItem.levels[locationId];
      const isStocked = available !== undefined;
      const actualAvailable = isStocked ? available : 0;
      const possible = isStocked ? Math.floor(actualAvailable / Math.max(1, baseItem.quantity)) : 0;

      if (!isStocked) {
        blockers.push(`${baseItem.title} is not stocked at this location`);
        minPossible = 0;
      } else {
        minPossible = Math.min(minPossible, possible);
      }

      locationItems.push({
        title: baseItem.title,
        available: actualAvailable,
        needed: baseItem.quantity,
        possible,
        stocked: isStocked,
      });
    }

    const maxBundles = minPossible === Infinity ? 0 : Math.max(0, minPossible);

    locationResults.push({
      locationId,
      locationName: locInfo.name,
      maxBundles,
      currentBundleStock: locInfo.currentStock,
      isSafe: locInfo.currentStock <= maxBundles,
      items: locationItems,
      blockers,
    });
  }

  const overallMaxBundles = locationResults.length > 0
    ? Math.max(...locationResults.map(l => l.maxBundles))
    : 0;

  return json({
    locations: locationResults,
    overallMaxBundles,
  });
};
