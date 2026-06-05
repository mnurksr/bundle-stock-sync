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
import { useTranslation } from "../utils/i18n";

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
  const { t } = useTranslation();
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
          <Badge tone="success">{t("rules_active")}</Badge>
        ) : (
          <Badge tone="new">{t("rules_inactive")}</Badge>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button
            size="slim"
            onClick={() => handleToggle(rule.id)}
          >
            {rule.isActive ? t("rules_pause") : t("rules_activate")}
          </Button>
          <Button
            size="slim"
            tone="critical"
            onClick={() => handleDelete(rule.id)}
          >
            {t("rules_btn_delete")}
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title={t("rules_title")}>
        <button variant="primary" onClick={() => navigate("/app/rules/new")}>
          {t("rules_add")}
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
                  { title: t("rules_col_bundle") },
                  { title: t("rules_col_base") },
                  { title: t("rules_col_multiplier") },
                  { title: t("rules_col_status") },
                  { title: t("rules_col_actions") },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          ) : (
            <Card>
              <EmptyState
                heading={t("rules_empty_title")}
                action={{
                  content: t("rules_add"),
                  url: "/app/rules/new",
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  {t("rules_empty_desc")}
                </p>
              </EmptyState>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={t("rules_modal_delete_title")}
        primaryAction={{
          content: t("rules_btn_delete"),
          destructive: true,
          onAction: confirmDelete,
        }}
        secondaryActions={[
          {
            content: t("rules_btn_cancel"),
            onAction: () => setDeleteModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            {t("rules_modal_delete_desc")}
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
