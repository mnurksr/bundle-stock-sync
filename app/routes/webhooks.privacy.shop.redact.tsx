import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  // Payload indicates the shop has requested deletion.
  // We will delete all data related to this shop.

  try {
    const dbShop = await db.shop.findUnique({ where: { shopDomain: shop } });
    if (dbShop) {
      // Deleting the shop will cascade delete BundleRules and SyncLogs
      await db.shop.delete({ where: { id: dbShop.id } });
      console.log(`Deleted all data for shop ${shop} due to shop/redact GDPR request`);
    }
  } catch (error) {
    console.error(`Error deleting shop data for ${shop}:`, error);
  }

  return new Response();
};
