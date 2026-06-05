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
import { useTranslation } from "../utils/i18n";

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
  const { t } = useTranslation();
  const isFree = shop.plan === "free";
  const quotaUsagePercent = isFree
    ? Math.round((stats.monthlySuccessSyncs / quotaLimit) * 100)
    : 0;
  const isQuotaWarning = isFree && quotaUsagePercent >= 80;

  const statusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge tone="success">{t("status_success")}</Badge>;
      case "failed":
        return <Badge tone="critical">{t("status_failed")}</Badge>;
      case "skipped":
        return <Badge tone="warning">{t("status_skipped")}</Badge>;
      case "pending":
        return <Badge tone="info">{t("status_pending")}</Badge>;
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
      <TitleBar title={t("dash_title")} />
      <BlockStack gap="500">
        {/* Welcome banner for new users */}
        {stats.totalRulesCount === 0 && (
          <Banner
            title={t("dash_welcome_title")}
            tone="info"
            action={{
              content: t("dash_create_rule"),
              url: "/app/rules/new",
            }}
          >
            <p>
              {t("dash_welcome_desc")}
            </p>
          </Banner>
        )}

        {/* Quota warning */}
        {isQuotaWarning && (
          <Banner
            title={t("dash_quota_warning_title")}
            tone="warning"
            action={{
              content: t("dash_upgrade"),
              url: "/app/settings",
            }}
          >
            <p>
              {t("dash_quota_warning_desc", { current: stats.monthlySuccessSyncs, limit: quotaLimit })}
            </p>
          </Banner>
        )}

        {/* Stats Cards */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm" tone="subdued">
                  {t("dash_active_rules")}
                </Text>
                <Text as="p" variant="headingXl">
                  {stats.activeRulesCount}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("dash_total_rules", { count: stats.totalRulesCount })}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm" tone="subdued">
                  {t("dash_monthly_syncs")}
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
                  {t("dash_success_rate")}
                </Text>
                <Text as="p" variant="headingXl">
                  {stats.successRate}%
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("dash_success_failed", { success: stats.successfulSyncs, failed: stats.failedSyncs })}
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
                {t("dash_recent_activity")}
              </Text>
              {recentLogs.length > 0 && (
                <RemixLink
                  to="/app/logs"
                  style={{ textDecoration: "none", color: "var(--p-color-text-link)" }}
                >
                  {t("dash_view_all")}
                </RemixLink>
              )}
            </InlineStack>

            {recentLogs.length > 0 ? (
              <IndexTable
                resourceName={{ singular: "sync", plural: "syncs" }}
                itemCount={recentLogs.length}
                headings={[
                  { title: t("dash_col_date") },
                  { title: t("dash_col_order") },
                  { title: t("dash_col_bundle") },
                  { title: t("dash_col_base") },
                  { title: t("dash_col_qty") },
                  { title: t("dash_col_adj") },
                  { title: t("dash_col_status") },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            ) : (
              <EmptyState
                heading={t("dash_empty_logs")}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  {t("dash_empty_logs_desc")}
                </p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
