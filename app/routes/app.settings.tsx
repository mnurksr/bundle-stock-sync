import { useEffect } from "react";
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
import { useTranslation } from "../utils/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    shop = await db.shop.create({ data: { shopDomain } });
  }

  // Check current billing status (check both live and test charges)
  let hasActiveSubscription = false;
  try {
    const liveCheck = await billing.check({ plans: [MONTHLY_PLAN], isTest: false });
    const testCheck = await billing.check({ plans: [MONTHLY_PLAN], isTest: true });
    hasActiveSubscription = liveCheck.hasActivePayment || testCheck.hasActivePayment;
  } catch (e) {
    console.error("Failed to check billing status:", e);
    hasActiveSubscription = false;
  }

  // Sync plan status with billing
  if (hasActiveSubscription && shop.plan !== "pro") {
    await db.shop.update({
      where: { shopDomain },
      data: { plan: "pro" },
    });
    shop = await db.shop.findUnique({ where: { shopDomain } });
  } else if (!hasActiveSubscription && shop.plan !== "free") {
    await db.shop.update({
      where: { shopDomain },
      data: { plan: "free" },
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
    // Get the shop from the session
    const { session } = await authenticate.admin(request);
    const shop = session.shop.replace(".myshopify.com", "");
    
    // Instead of using Billing API (which throws an error when Managed Pricing is enabled),
    // we redirect the merchant to the Shopify-hosted Managed Pricing page.
    // The handle is "bundle-stock-sync-3" based on the user's screenshots.
    const redirectUrl = `https://admin.shopify.com/store/${shop}/charges/bundle-stock-sync-3/pricing_plans`;
    
    return { redirectUrl, success: true, error: undefined, details: undefined };
  }

  return { error: "Unknown action", details: undefined, success: undefined, redirectUrl: undefined };
};

export default function SettingsPage() {
  const { shop, monthlySyncs, totalRules, quotaLimit, hasActiveSubscription } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();
  const nav = useNavigation();
  const shopify = useAppBridge();
  const { t } = useTranslation();

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

  useEffect(() => {
    if (actionData && "redirectUrl" in actionData && actionData.redirectUrl) {
      if (typeof window !== "undefined") {
        window.open(actionData.redirectUrl, "_top");
      }
    }
  }, [actionData]);

  return (
    <Page>
      <TitleBar title="Settings" />

      <BlockStack gap="500">
        {(actionData as any)?.error && (
          <Banner title="Error" tone="critical">
            <p>
              {(actionData as any).error === "dev_store_billing_error" 
                ? "Billing Error: Cannot create real charges on a Development Store. To test billing, you must run the app in development mode."
                : "Billing Error: Something went wrong. Please try again or contact support."}
            </p>
            {(actionData as any).details && (
              <p style={{ marginTop: "1rem", fontSize: "12px", fontFamily: "monospace" }}>
                Details: {(actionData as any).details}
              </p>
            )}
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
                      {t("settings_plan")}
                    </Text>
                    {isFree ? (
                      <Badge>{t("settings_plan_free")}</Badge>
                    ) : (
                      <Badge tone="success">{t("settings_plan_pro")}</Badge>
                    )}
                  </InlineStack>

                  <Divider />

                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      {t("settings_plan_monthly_syncs")}
                    </Text>
                    <Text as="span" fontWeight="bold">
                      {monthlySyncs}
                      {isFree ? ` / ${quotaLimit}` : t("settings_plan_unlimited")}
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
                      {t("settings_plan_active_rules")}
                    </Text>
                    <Text as="span">{totalRules}</Text>
                  </InlineStack>

                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      {t("settings_plan_installed")}
                    </Text>
                    <Text as="span">{formatDate(shop.installedAt)}</Text>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Plan Comparison */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("settings_compare_title")}
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
                          {t("settings_free")}
                        </Text>
                        <Text as="span" variant="headingMd">
                          $0
                        </Text>
                      </InlineStack>
                      <List>
                        <List.Item>{t("settings_compare_free_1")}</List.Item>
                        <List.Item>{t("settings_compare_free_2")}</List.Item>
                        <List.Item>{t("settings_compare_free_3")}</List.Item>
                        <List.Item>{t("settings_compare_free_4")}</List.Item>
                      </List>
                      {isFree && (
                        <Badge tone="info">{t("settings_compare_current")}</Badge>
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
                          {t("settings_compare_pro_1")}
                        </List.Item>
                        <List.Item>{t("settings_compare_pro_2")}</List.Item>
                        <List.Item>{t("settings_compare_pro_3")}</List.Item>
                        <List.Item>{t("settings_compare_pro_4")}</List.Item>
                        <List.Item>
                          {t("settings_compare_pro_5")}
                        </List.Item>
                      </List>
                      {!isFree ? (
                        <Badge tone="success">{t("settings_compare_current")}</Badge>
                      ) : (
                        <Form method="POST">
                          <input type="hidden" name="intent" value="upgrade" />
                          <Button
                            variant="primary"
                            submit
                            loading={nav.state === "submitting" && nav.formData?.get("intent") === "upgrade"}
                          >
                            {t("settings_upgrade_btn")}
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
                      {t("settings_upgrade_title")}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {t("settings_upgrade_desc1")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("settings_upgrade_desc2")}
                    </Text>
                    <Form method="POST">
                      <input type="hidden" name="intent" value="upgrade" />
                      <Button
                        variant="primary"
                        fullWidth
                        submit
                        loading={nav.state === "submitting" && nav.formData?.get("intent") === "upgrade"}
                      >
                        {t("settings_upgrade_now")}
                      </Button>
                    </Form>
                  </BlockStack>
                </Card>
              )}

              {/* About */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("settings_about_title")}
                  </Text>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      {t("settings_about_app")}
                    </Text>
                    <Text as="span">Bundle Stock Sync</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      {t("settings_about_version")}
                    </Text>
                    <Text as="span">1.0.0</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      {t("settings_about_api")}
                    </Text>
                    <Text as="span">2026-04</Text>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Support */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("settings_help_title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("settings_help_desc")}
                  </Text>
                  <a href="mailto:mnurksr@gmail.com" target="_top" style={{ textDecoration: 'none' }}>
                    <Button>
                      {t("settings_help_btn")}
                    </Button>
                  </a>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
