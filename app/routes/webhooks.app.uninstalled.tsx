import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Clean up session data (Shopify default behavior)
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Mark shop as inactive and record uninstall time
  try {
    const shopRecord = await db.shop.findUnique({ where: { shopDomain: shop } });
    if (shopRecord) {
      await db.shop.update({
        where: { shopDomain: shop },
        data: {
          isActive: false,
          uninstalledAt: new Date(),
        },
      });
      console.log(`Shop ${shop} marked as inactive after uninstall`);
    }
  } catch (error) {
    console.error(`Error handling uninstall for ${shop}:`, error);
  }

  return new Response();
};
