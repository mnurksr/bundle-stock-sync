import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  IndexTable,
  EmptyState,
  Select,
  Pagination,
  Box,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useTranslation } from "../utils/i18n";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  
  if (shop) {
    const formData = await request.formData();
    if (formData.get("action") === "clearLogs") {
      await db.syncLog.deleteMany({ where: { shopId: shop.id } });
    }
  }
  return null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);

  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = 20;
  const statusFilter = url.searchParams.get("status") || "all";

  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    return {
      logs: [],
      total: 0,
      page: 1,
      totalPages: 1,
      statusFilter: "all",
    };
  }

  const where: any = { shopId: shop.id };
  if (statusFilter !== "all") {
    where.status = statusFilter;
  }

  const [logs, total] = await Promise.all([
    db.syncLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { bundleRule: true },
    }),
    db.syncLog.count({ where }),
  ]);

  return {
    logs: logs.map((log) => ({
      id: log.id,
      orderId: log.orderId,
      orderName: log.orderName,
      bundleProductTitle: log.bundleRule?.bundleProductTitle || "Deleted Rule",
      itemsSummary: log.itemsSummary,
      status: log.status,
      errorMessage: log.errorMessage,
      createdAt: log.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    statusFilter,
  };
};

export default function SyncLogsPage() {
  const { logs, total, page, totalPages, statusFilter } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const submit = useSubmit();
  const { t } = useTranslation();

  const handleClearLogs = () => {
    if (confirm(t("logs_clear_confirm"))) {
      submit({ action: "clearLogs" }, { method: "post" });
    }
  };

  const handleStatusChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("status", value);
    params.set("page", "1");
    setSearchParams(params);
  };

  const handlePrevious = () => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(Math.max(1, page - 1)));
    setSearchParams(params);
  };

  const handleNext = () => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(Math.min(totalPages, page + 1)));
    setSearchParams(params);
  };

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
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const statusOptions = [
    { label: t("logs_status_all"), value: "all" },
    { label: t("logs_status_success"), value: "success" },
    { label: t("logs_status_failed"), value: "failed" },
    { label: t("logs_status_skipped"), value: "skipped" },
    { label: t("logs_status_pending"), value: "pending" },
  ];

  const rowMarkup = logs.map((log, index) => {
    const isUpSync = log.orderName.includes("Up-Sync") || log.orderName === "Base Stock Changed";
    
    // Format Event Name
    const eventName = isUpSync ? t("logs_event_up_sync") : t("logs_event_order", { orderName: log.orderName });
    
    let summaryData: any[] = [];
    try {
      summaryData = JSON.parse(log.itemsSummary || "[]");
    } catch(e) {}
    
    const itemsDescription = summaryData.map((item: any, i: number) => (
      <Text key={i} as="p" variant="bodySm" tone="critical">
        {item.title}: -{item.totalAdjustment} (Sold {item.quantitySold} x {item.multiplier})
      </Text>
    ));

    return (
      <IndexTable.Row id={log.id} key={log.id} position={index}>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {formatDate(log.createdAt)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" fontWeight="bold">
            {eventName}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {log.bundleProductTitle}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
           {isUpSync ? (
             <Text as="span" tone="success">{log.errorMessage || "Stock recalculated"}</Text>
           ) : (
             <BlockStack gap="100">{itemsDescription}</BlockStack>
           )}
        </IndexTable.Cell>
        <IndexTable.Cell>{statusBadge(log.status)}</IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page fullWidth>
      <TitleBar title={t("logs_title")}>
        <button onClick={handleClearLogs}>
          {t("logs_clear")}
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {/* Filters */}
        <Card>
          <InlineStack gap="400" align="start" blockAlign="center">
            <Box minWidth="200px">
              <Select
                label={t("logs_filter_status")}
                labelInline
                options={statusOptions}
                value={statusFilter}
                onChange={handleStatusChange}
              />
            </Box>
            <Text as="span" variant="bodySm" tone="subdued">
              {total} {t("logs_total")}
            </Text>
          </InlineStack>
        </Card>

        {/* Logs Table */}
        {logs.length > 0 ? (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "sync log", plural: "sync logs" }}
              itemCount={logs.length}
              headings={[
                { title: t("logs_col_date") },
                { title: t("logs_col_event") },
                { title: t("logs_col_rule") },
                { title: t("logs_col_action") },
                { title: t("logs_col_status") },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        ) : (
          <Card>
            <EmptyState
              heading={t("logs_empty")}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>{t("logs_empty_desc")}</p>
            </EmptyState>
          </Card>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => {
                const params = new URLSearchParams(searchParams);
                params.set("page", String(page - 1));
                setSearchParams(params);
              }}
              hasNext={page < totalPages}
              onNext={() => {
                const params = new URLSearchParams(searchParams);
                params.set("page", String(page + 1));
                setSearchParams(params);
              }}
              label={t("logs_page", { page, totalPages })}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
