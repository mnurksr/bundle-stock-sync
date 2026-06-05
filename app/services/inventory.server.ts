import { v4 as uuidv4 } from "uuid";

// Type for the admin GraphQL client from Shopify
// Using 'any' for return type to handle both direct admin.graphql and manual fetch wrappers
type AdminApiContext = {
  graphql: (query: string, options?: { variables?: Record<string, any> }) => Promise<any>;
};


export async function adjustInventory(
  admin: AdminApiContext,
  inventoryItemId: string,
  locationId: string,
  delta: number,
  reason: string = "correction"
) {
  const idempotencyKey = uuidv4();

  const response = await admin.graphql(
    `#graphql
    mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup {
          createdAt
          reason
          changes {
            name
            delta
            quantityAfterChange
          }
        }
        userErrors {
          field
          message
          code
        }
      }
    }`,
    {
      variables: {
        input: {
          reason,
          name: "available",
          changes: [
            {
              inventoryItemId,
              locationId,
              delta,
            },
          ],
        },
      },
    }
  );

  const result = await response.json();
  
  if (result.data?.inventoryAdjustQuantities?.userErrors?.length > 0) {
    const errors = result.data.inventoryAdjustQuantities.userErrors;
    throw new Error(`Inventory adjustment failed: ${errors.map((e: any) => e.message).join(", ")}`);
  }

  return {
    success: true,
    idempotencyKey,
    changes: result.data?.inventoryAdjustQuantities?.inventoryAdjustmentGroup?.changes || [],
  };
}

export async function getInventoryItemId(admin: AdminApiContext, variantId: string): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
    query getInventoryItemId($variantId: ID!) {
      productVariant(id: $variantId) {
        inventoryItem {
          id
        }
      }
    }`,
    {
      variables: { variantId },
    }
  );

  const result = await response.json();
  return result.data?.productVariant?.inventoryItem?.id || null;
}

export async function getLocations(admin: AdminApiContext): Promise<Array<{ id: string; name: string }>> {
  const response = await admin.graphql(
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

  const result = await response.json();
  return result.data?.locations?.edges?.map((edge: any) => edge.node) || [];
}

export async function getInventoryLevel(
  admin: AdminApiContext,
  inventoryItemId: string,
  locationId: string
): Promise<number | null> {
  const response = await admin.graphql(
    `#graphql
    query getInventoryLevel($inventoryItemId: ID!) {
      inventoryItem(id: $inventoryItemId) {
        inventoryLevels(first: 10) {
          edges {
            node {
              location {
                id
              }
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }`,
    {
      variables: { inventoryItemId },
    }
  );

  const result = await response.json();
  const levels = result.data?.inventoryItem?.inventoryLevels?.edges || [];
  
  for (const edge of levels) {
    if (edge.node.location.id === locationId) {
      const available = edge.node.quantities?.find((q: any) => q.name === "available");
      return available?.quantity ?? null;
    }
  }
  
  return null;
}

export async function getProductVariantDetails(admin: AdminApiContext, variantId: string) {
  const response = await admin.graphql(
    `#graphql
    query getVariantDetails($variantId: ID!) {
      productVariant(id: $variantId) {
        id
        title
        sku
        displayName
        inventoryItem {
          id
        }
        product {
          id
          title
        }
      }
    }`,
    {
      variables: { variantId },
    }
  );

  const result = await response.json();
  return result.data?.productVariant || null;
}
