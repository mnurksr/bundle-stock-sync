import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} GDPR webhook for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // A customer has requested their data.
      // This app does not store personal customer data in sync logs.
      // We only store order IDs and product variant IDs.
      console.log(`Customer data request for ${shop} - no personal data stored`);
      break;

    case "CUSTOMERS_REDACT":
      // A customer has requested deletion of their data.
      // This app does not store personal customer data.
      console.log(`Customer redact request for ${shop} - no personal data to delete`);
      break;

    case "SHOP_REDACT":
      // 48 hours after app uninstall, Shopify requests full data deletion.
      // Delete all shop-related data from our database.
      try {
        const shopRecord = await db.shop.findUnique({ where: { shopDomain: shop } });
        if (shopRecord) {
          // Delete sync logs first (foreign key constraint)
          await db.syncLog.deleteMany({ where: { shopId: shopRecord.id } });
          // Delete bundle rules
          await db.bundleRule.deleteMany({ where: { shopId: shopRecord.id } });
          // Delete shop record
          await db.shop.delete({ where: { id: shopRecord.id } });
          console.log(`All data deleted for shop ${shop} (SHOP_REDACT)`);
        }
      } catch (error) {
        console.error(`Error processing SHOP_REDACT for ${shop}:`, error);
      }
      break;

    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response();
};
