const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.session.findMany({ where: { shop: "shopiauto-test.myshopify.com" } });
  const offlineSession = sessions.find(s => !s.isOnline);
  if (!offlineSession) {
    console.log("No offline session found.");
    return;
  }
  
  console.log("Found offline session with token.");
  
  const response = await fetch(`https://shopiauto-test.myshopify.com/admin/api/2024-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": offlineSession.accessToken,
    },
    body: JSON.stringify({
      query: `
        query {
          webhookSubscriptions(first: 10) {
            edges {
              node {
                id
                topic
                endpoint {
                  __typename
                  ... on WebhookHttpEndpoint {
                    callbackUrl
                  }
                }
              }
            }
          }
        }
      `
    })
  });
  
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
