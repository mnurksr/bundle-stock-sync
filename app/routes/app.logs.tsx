import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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
      baseProductTitle: log.bundleRule?.baseProductTitle || "Deleted Rule",
      quantitySold: log.quantitySold,
      multiplier: log.multiplier,
      totalAdjustment: log.totalAdjustment,
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
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const statusOptions = [
    { label: "All statuses", value: "all" },
    { label: "Success", value: "success" },
    { label: "Failed", value: "failed" },
    { label: "Skipped", value: "skipped" },
    { label: "Pending", value: "pending" },
  ];

  const rowMarkup = logs.map((log, index) => (
    <IndexTable.Row id={log.id} key={log.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {formatDate(log.createdAt)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {log.orderName}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {log.bundleProductTitle}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {log.baseProductTitle}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="center">
          {log.orderName.includes("Up-Sync") ? "-" : log.quantitySold}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="center">
          ×{log.multiplier}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {log.orderName.includes("Up-Sync") ? (
          <Text as="span" fontWeight="bold" tone="success">
            = {log.totalAdjustment}
          </Text>
        ) : (
          <Text as="span" fontWeight="bold" tone="critical">
            -{log.totalAdjustment}
          </Text>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(log.status)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="Sync Logs" />

      <BlockStack gap="500">
        {/* Filters */}
        <Card>
          <InlineStack gap="400" align="start" blockAlign="center">
            <Box minWidth="200px">
              <Select
                label="Filter by status"
                labelInline
                options={statusOptions}
                value={statusFilter}
                onChange={handleStatusChange}
              />
            </Box>
            <Text as="span" variant="bodySm" tone="subdued">
              {total} total log{total !== 1 ? "s" : ""}
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
                { title: "Date/Time" },
                { title: "Order" },
                { title: "Bundle Product" },
                { title: "Base Product" },
                { title: "Qty Sold" },
                { title: "Multiplier" },
                { title: "Adjustment" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        ) : (
          <Card>
            <EmptyState
              heading="No sync logs found"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                {statusFilter !== "all"
                  ? `No ${statusFilter} sync logs found. Try changing the filter.`
                  : "Sync logs will appear here once orders with bundle products are placed."}
              </p>
            </EmptyState>
          </Card>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 1}
              hasNext={page < totalPages}
              onPrevious={handlePrevious}
              onNext={handleNext}
              label={`Page ${page} of ${totalPages}`}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
