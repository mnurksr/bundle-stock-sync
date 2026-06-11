import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const variantIdsStr = formData.get("variantIds");
  
  if (!variantIdsStr || typeof variantIdsStr !== "string") {
    return json({ error: "Missing variantIds" }, { status: 400 });
  }

  let variantIds: string[] = [];
  try {
    variantIds = JSON.parse(variantIdsStr);
  } catch (e) {
    return json({ error: "Invalid JSON for variantIds" }, { status: 400 });
  }

  const result: Record<string, string[]> = {};

  for (const variantId of variantIds) {
    try {
      const res = await admin.graphql(
        `#graphql
        query getVariantLocations($id: ID!) {
          productVariant(id: $id) {
            inventoryItem {
              inventoryLevels(first: 50) {
                edges {
                  node {
                    location {
                      id
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { id: variantId } }
      );
      
      const data = await res.json();
      const levels = data.data?.productVariant?.inventoryItem?.inventoryLevels?.edges || [];
      const locations = levels.map((edge: any) => edge.node.location.id);
      
      result[variantId] = locations;
    } catch (error) {
      console.error(`Failed to fetch locations for variant ${variantId}:`, error);
      result[variantId] = [];
    }
  }

  return json({ locations: result });
};
