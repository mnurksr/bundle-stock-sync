import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { useState, useCallback } from "react";
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
  Button,
  Modal,
  ButtonGroup,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    return { rules: [] };
  }

  const rules = await db.bundleRule.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    rules: rules.map((rule) => ({
      id: rule.id,
      bundleProductTitle: rule.bundleProductTitle,
      bundleSku: rule.bundleSku,
      baseProductTitle: rule.baseProductTitle,
      baseSku: rule.baseSku,
      multiplier: rule.multiplier,
      isActive: rule.isActive,
      createdAt: rule.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const ruleId = formData.get("ruleId") as string;

  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    return { error: "Shop not found" };
  }

  switch (intent) {
    case "toggle": {
      const rule = await db.bundleRule.findFirst({
        where: { id: ruleId, shopId: shop.id },
      });
      if (rule) {
        await db.bundleRule.update({
          where: { id: ruleId },
          data: { isActive: !rule.isActive },
        });
      }
      return { success: true };
    }
    case "delete": {
      await db.bundleRule.deleteMany({
        where: { id: ruleId, shopId: shop.id },
      });
      return { success: true };
    }
    default:
      return { error: "Unknown action" };
  }
};

export default function BundleRulesPage() {
  const { rules } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);

  const handleDelete = useCallback((ruleId: string) => {
    setDeleteRuleId(ruleId);
    setDeleteModalOpen(true);
  }, []);

  const confirmDelete = useCallback(() => {
    if (deleteRuleId) {
      fetcher.submit(
        { intent: "delete", ruleId: deleteRuleId },
        { method: "POST" }
      );
    }
    setDeleteModalOpen(false);
    setDeleteRuleId(null);
  }, [deleteRuleId, fetcher]);

  const handleToggle = useCallback(
    (ruleId: string) => {
      fetcher.submit(
        { intent: "toggle", ruleId },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const rowMarkup = rules.map((rule, index) => (
    <IndexTable.Row
      id={rule.id}
      key={rule.id}
      position={index}
      onClick={() => navigate(`/app/rules/${rule.id}`)}
    >
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {rule.bundleProductTitle}
          </Text>
          {rule.bundleSku && (
            <Text as="span" variant="bodySm" tone="subdued">
              SKU: {rule.bundleSku}
            </Text>
          )}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodyMd">
            {rule.baseProductTitle}
          </Text>
          {rule.baseSku && (
            <Text as="span" variant="bodySm" tone="subdued">
              SKU: {rule.baseSku}
            </Text>
          )}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="magic">{`×${rule.multiplier}`}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {rule.isActive ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="new">Inactive</Badge>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button
            size="slim"
            onClick={() => handleToggle(rule.id)}
          >
            {rule.isActive ? "Pause" : "Activate"}
          </Button>
          <Button
            size="slim"
            tone="critical"
            onClick={() => handleDelete(rule.id)}
          >
            Delete
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="Bundle Rules">
        <button variant="primary" onClick={() => navigate("/app/rules/new")}>
          Add Rule
        </button>
      </TitleBar>

      <Layout>
        <Layout.Section>
          {rules.length > 0 ? (
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "rule", plural: "rules" }}
                itemCount={rules.length}
                headings={[
                  { title: "Bundle Product" },
                  { title: "Base Product" },
                  { title: "Multiplier" },
                  { title: "Status" },
                  { title: "Actions" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          ) : (
            <Card>
              <EmptyState
                heading="Create your first bundle rule"
                action={{
                  content: "Add Rule",
                  url: "/app/rules/new",
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Link a multipack/bundle product to its base product. When the
                  bundle sells, inventory on the base product will be
                  automatically adjusted.
                </p>
              </EmptyState>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete bundle rule?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: confirmDelete,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This will permanently remove this bundle rule. Future orders with
            this bundle product will no longer trigger automatic inventory
            adjustments. Existing sync logs will be preserved.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
