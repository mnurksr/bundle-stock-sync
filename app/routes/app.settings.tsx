import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, useFetcher, Form, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  Box,
  Divider,
  List,
  Icon,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    shop = await db.shop.create({ data: { shopDomain } });
  }

  // Check current billing status
  let hasActiveSubscription = false;
  try {
    await billing.require({
      plans: [MONTHLY_PLAN],
      isTest: true, // Check for test subscriptions on development stores
      onFailure: async () => {
        hasActiveSubscription = false;
        return undefined as any;
      },
    });
    hasActiveSubscription = true;
  } catch {
    hasActiveSubscription = false;
  }

  // Sync plan status with billing
  if (hasActiveSubscription && shop.plan !== "pro") {
    await db.shop.update({
      where: { shopDomain },
      data: { plan: "pro" },
    });
    shop = await db.shop.findUnique({ where: { shopDomain } });
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlySyncs = await db.syncLog.count({
    where: {
      shopId: shop!.id,
      status: "success",
      createdAt: { gte: startOfMonth },
    },
  });

  const totalRules = await db.bundleRule.count({
    where: { shopId: shop!.id },
  });

  return {
    shop: {
      plan: shop!.plan,
      syncCount: shop!.syncCount,
      installedAt: shop!.installedAt.toISOString(),
    },
    monthlySyncs,
    totalRules,
    quotaLimit: 50,
    hasActiveSubscription,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "upgrade") {
    try {
      await billing.require({
        plans: [MONTHLY_PLAN],
        isTest: true, // Set to true to allow testing on development stores
        onFailure: async () =>
          billing.request({
            plan: MONTHLY_PLAN,
            isTest: true, // Set to true to allow testing on development stores
            returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/settings`,
          }),
      });
      return { success: true };
    } catch (error) {
      if (error instanceof Response) {
        // Shopify throws a Response to redirect the user to the billing approval page
        throw error;
      }
      return { error: String(error) };
    }
  }

  return { error: "Unknown action" };
};

export default function SettingsPage() {
  const { shop, monthlySyncs, totalRules, quotaLimit, hasActiveSubscription } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();
  const nav = useNavigation();
  const shopify = useAppBridge();

  const isFree = shop.plan === "free";
  const quotaUsagePercent = isFree
    ? Math.round((monthlySyncs / quotaLimit) * 100)
    : 0;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <Page>
      <TitleBar title="Settings" />

      <BlockStack gap="500">
        {"error" in (actionData || {}) && (
          <Banner title="Error" tone="critical">
            <p>{(actionData as any).error}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              {/* Current Plan */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Current Plan
                    </Text>
                    {isFree ? (
                      <Badge>Free</Badge>
                    ) : (
                      <Badge tone="success">Pro — $3/mo</Badge>
                    )}
                  </InlineStack>

                  <Divider />

                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Monthly syncs used
                    </Text>
                    <Text as="span" fontWeight="bold">
                      {monthlySyncs}
                      {isFree ? ` / ${quotaLimit}` : " (unlimited)"}
                    </Text>
                  </InlineStack>
                  {isFree && (
                    <ProgressBar
                      progress={Math.min(quotaUsagePercent, 100)}
                      tone={quotaUsagePercent >= 80 ? "critical" : "primary"}
                      size="small"
                    />
                  )}

                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Active bundle rules
                    </Text>
                    <Text as="span">{totalRules}</Text>
                  </InlineStack>

                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Installed since
                    </Text>
                    <Text as="span">{formatDate(shop.installedAt)}</Text>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Plan Comparison */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Plan Comparison
                  </Text>

                  <Divider />

                  {/* Free Plan */}
                  <Box
                    padding="400"
                    background={isFree ? "bg-surface-selected" : "bg-surface"}
                    borderRadius="200"
                    borderWidth="025"
                    borderColor={isFree ? "border-emphasis" : "border"}
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          Free Plan
                        </Text>
                        <Text as="span" variant="headingMd">
                          $0
                        </Text>
                      </InlineStack>
                      <List>
                        <List.Item>50 inventory syncs per month</List.Item>
                        <List.Item>Unlimited bundle rules</List.Item>
                        <List.Item>Basic sync logs</List.Item>
                        <List.Item>Email support</List.Item>
                      </List>
                      {isFree && (
                        <Badge tone="info">Current plan</Badge>
                      )}
                    </BlockStack>
                  </Box>

                  {/* Pro Plan */}
                  <Box
                    padding="400"
                    background={!isFree ? "bg-surface-selected" : "bg-surface"}
                    borderRadius="200"
                    borderWidth="025"
                    borderColor={!isFree ? "border-emphasis" : "border"}
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          Pro Plan
                        </Text>
                        <Text as="span" variant="headingMd">
                          $3/mo
                        </Text>
                      </InlineStack>
                      <List>
                        <List.Item>
                          <strong>Unlimited</strong> inventory syncs
                        </List.Item>
                        <List.Item>Unlimited bundle rules</List.Item>
                        <List.Item>Full sync history & logs</List.Item>
                        <List.Item>Priority support</List.Item>
                        <List.Item>
                          No surprises — flat monthly price
                        </List.Item>
                      </List>
                      {!isFree ? (
                        <Badge tone="success">Current plan</Badge>
                      ) : (
                        <Form method="POST">
                          <input type="hidden" name="intent" value="upgrade" />
                          <Button
                            variant="primary"
                            submit
                            loading={nav.state === "submitting" && nav.formData?.get("intent") === "upgrade"}
                          >
                            Upgrade to Pro — $3/mo
                          </Button>
                        </Form>
                      )}
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              {/* Upgrade CTA for Free Users */}
              {isFree && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      🚀 Upgrade to Pro
                    </Text>
                    <Text as="p" variant="bodyMd">
                      Never worry about sync limits. Get unlimited inventory
                      syncs for just <strong>$3/month</strong>.
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Perfect for stores with high order volume or multiple
                      bundle products.
                    </Text>
                    <Form method="POST">
                      <input type="hidden" name="intent" value="upgrade" />
                      <Button
                        variant="primary"
                        fullWidth
                        submit
                        loading={nav.state === "submitting" && nav.formData?.get("intent") === "upgrade"}
                      >
                        Upgrade Now
                      </Button>
                    </Form>
                  </BlockStack>
                </Card>
              )}

              {/* About */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    About
                  </Text>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      App
                    </Text>
                    <Text as="span">Bundle Stock Sync</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Version
                    </Text>
                    <Text as="span">1.0.0</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      API Version
                    </Text>
                    <Text as="span">2026-04</Text>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Support */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Need Help?
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    If you encounter any issues or have feature requests,
                    please reach out to our support team.
                  </Text>
                  <Button url="mailto:support@bundlestocksync.com" external>
                    Contact Support
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
