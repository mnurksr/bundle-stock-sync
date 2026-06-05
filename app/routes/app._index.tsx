import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link as RemixLink } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Banner,
  ProgressBar,
  Badge,
  IndexTable,
  EmptyState,
  Icon,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get or create shop
  let shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    shop = await db.shop.create({ data: { shopDomain, isActive: true } });
  } else if (!shop.isActive) {
    shop = await db.shop.update({
      where: { shopDomain },
      data: { isActive: true }
    });
  }

  // Get stats
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    activeRulesCount,
    totalRulesCount,
    monthlySuccessSyncs,
    totalSyncs,
    successfulSyncs,
    failedSyncs,
    recentLogs,
  ] = await Promise.all([
    db.bundleRule.count({ where: { shopId: shop.id, isActive: true } }),
    db.bundleRule.count({ where: { shopId: shop.id } }),
    db.syncLog.count({
      where: {
        shopId: shop.id,
        status: "success",
        createdAt: { gte: startOfMonth },
      },
    }),
    db.syncLog.count({ where: { shopId: shop.id } }),
    db.syncLog.count({ where: { shopId: shop.id, status: "success" } }),
    db.syncLog.count({ where: { shopId: shop.id, status: "failed" } }),
    db.syncLog.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { bundleRule: true },
    }),
  ]);

  const successRate =
    totalSyncs > 0 ? Math.round((successfulSyncs / totalSyncs) * 100) : 0;

  return {
    shop: {
      plan: shop.plan,
      syncCount: shop.syncCount,
    },
    stats: {
      activeRulesCount,
      totalRulesCount,
      monthlySuccessSyncs,
      totalSyncs,
      successfulSyncs,
      failedSyncs,
      successRate,
    },
    recentLogs: recentLogs.map((log) => ({
      id: log.id,
      orderId: log.orderId,
      orderName: log.orderName,
      bundleProductTitle: log.bundleRule?.bundleProductTitle || "Deleted Rule",
      baseProductTitle: log.bundleRule?.baseProductTitle || "Deleted Rule",
      quantitySold: log.quantitySold,
      multiplier: log.multiplier,
      totalAdjustment: log.totalAdjustment,
      status: log.status,
      createdAt: log.createdAt.toISOString(),
    })),
    quotaLimit: 50,
  };
};

export default function Dashboard() {
  const { shop, stats, recentLogs, quotaLimit } =
    useLoaderData<typeof loader>();
  const isFree = shop.plan === "free";
  const quotaUsagePercent = isFree
    ? Math.round((stats.monthlySuccessSyncs / quotaLimit) * 100)
    : 0;
  const isQuotaWarning = isFree && quotaUsagePercent >= 80;

  const statusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge tone="success">Success</Badge>;
      case "failed":
        return <Badge tone="critical">Failed</Badge>;
      case "skipped":
        return <Badge tone="warning">Skipped</Badge>;
      case "pending":
        return <Badge tone="info">Pending</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const rowMarkup = recentLogs.map((log, index) => (
    <IndexTable.Row id={log.id} key={log.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {formatDate(log.createdAt)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {log.orderName}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{log.bundleProductTitle}</IndexTable.Cell>
      <IndexTable.Cell>{log.baseProductTitle}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="center">
          {log.quantitySold}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold" tone="magic">
          -{log.totalAdjustment}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(log.status)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="Bundle Stock Sync" />
      <BlockStack gap="500">
        {/* Welcome banner for new users */}
        {stats.totalRulesCount === 0 && (
          <Banner
            title="Welcome to Bundle Stock Sync!"
            tone="info"
            action={{
              content: "Create your first rule",
              url: "/app/rules/new",
            }}
          >
            <p>
              Start by creating a bundle rule to link your multipack products
              with their base products. The app will automatically sync
              inventory when bundles are sold.
            </p>
          </Banner>
        )}

        {/* Quota warning */}
        {isQuotaWarning && (
          <Banner
            title="Approaching sync limit"
            tone="warning"
            action={{
              content: "Upgrade to Pro ($3/mo)",
              url: "/app/settings",
            }}
          >
            <p>
              You've used {stats.monthlySuccessSyncs} of {quotaLimit} free
              monthly syncs. Upgrade to Pro for unlimited syncs.
            </p>
          </Banner>
        )}

        {/* Stats Cards */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm" tone="subdued">
                  Active Rules
                </Text>
                <Text as="p" variant="headingXl">
                  {stats.activeRulesCount}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.totalRulesCount} total rules configured
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm" tone="subdued">
                  Monthly Syncs
                </Text>
                <Text as="p" variant="headingXl">
                  {stats.monthlySuccessSyncs}
                  {isFree && (
                    <Text as="span" variant="bodyMd" tone="subdued">
                      {" "}
                      / {quotaLimit}
                    </Text>
                  )}
                  {!isFree && (
                    <Text as="span" variant="bodyMd" tone="subdued">
                      {" "}
                      (unlimited)
                    </Text>
                  )}
                </Text>
                {isFree && (
                  <ProgressBar
                    progress={Math.min(quotaUsagePercent, 100)}
                    tone={quotaUsagePercent >= 80 ? "critical" : "primary"}
                    size="small"
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm" tone="subdued">
                  Success Rate
                </Text>
                <Text as="p" variant="headingXl">
                  {stats.successRate}%
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.successfulSyncs} succeeded, {stats.failedSyncs} failed
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Recent Sync Logs */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Recent Sync Activity
              </Text>
              {recentLogs.length > 0 && (
                <RemixLink
                  to="/app/logs"
                  style={{ textDecoration: "none", color: "var(--p-color-text-link)" }}
                >
                  View all logs →
                </RemixLink>
              )}
            </InlineStack>

            {recentLogs.length > 0 ? (
              <IndexTable
                resourceName={{ singular: "sync", plural: "syncs" }}
                itemCount={recentLogs.length}
                headings={[
                  { title: "Date" },
                  { title: "Order" },
                  { title: "Bundle Product" },
                  { title: "Base Product" },
                  { title: "Qty" },
                  { title: "Adjustment" },
                  { title: "Status" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            ) : (
              <EmptyState
                heading="No sync activity yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Sync logs will appear here once orders with bundle products
                  are placed in your store.
                </p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
