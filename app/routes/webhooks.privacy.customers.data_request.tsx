import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  // Payload contains customer data.
  // In a real app, you would compile the data you have about this customer
  // and send it to the store owner or process it according to GDPR.
  // We do not store personal customer data in this app, so we return 200 OK.

  return new Response();
};
