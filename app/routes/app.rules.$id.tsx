import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigate,
} from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Banner,
  Badge,
  Modal,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const ruleId = params.id;

  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const rule = await db.bundleRule.findFirst({
    where: { id: ruleId, shopId: shop.id },
  });

  if (!rule) {
    throw new Response("Rule not found", { status: 404 });
  }

  // Get sync stats for this rule
  const syncCount = await db.syncLog.count({
    where: { bundleRuleId: rule.id, status: "success" },
  });

  return {
    rule: {
      id: rule.id,
      bundleProductId: rule.bundleProductId,
      bundleVariantId: rule.bundleVariantId,
      bundleProductTitle: rule.bundleProductTitle,
      bundleSku: rule.bundleSku,
      baseProductId: rule.baseProductId,
      baseVariantId: rule.baseVariantId,
      baseProductTitle: rule.baseProductTitle,
      baseSku: rule.baseSku,
      multiplier: rule.multiplier,
      isActive: rule.isActive,
      createdAt: rule.createdAt.toISOString(),
    },
    syncCount,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const ruleId = params.id;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    return { error: "Shop not found" };
  }

  switch (intent) {
    case "update": {
      const multiplier =
        parseInt(formData.get("multiplier") as string, 10) || 1;
      const isActive = formData.get("isActive") === "true";

      if (multiplier < 1) {
        return { error: "Multiplier must be at least 1." };
      }

      await db.bundleRule.updateMany({
        where: { id: ruleId, shopId: shop.id },
        data: { multiplier, isActive },
      });

      return { success: true, message: "Rule updated successfully." };
    }
    case "delete": {
      await db.bundleRule.deleteMany({
        where: { id: ruleId, shopId: shop.id },
      });
      return redirect("/app/rules");
    }
    default:
      return { error: "Unknown action" };
  }
};

export default function EditBundleRulePage() {
  const { rule, syncCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [multiplier, setMultiplier] = useState(String(rule.multiplier));
  const [isActive, setIsActive] = useState(rule.isActive);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    const formData = new FormData();
    formData.append("intent", "update");
    formData.append("multiplier", multiplier);
    formData.append("isActive", String(isActive));
    submit(formData, { method: "POST" });
    setIsSaving(false);
    shopify.toast.show("Rule updated");
  }, [multiplier, isActive, submit, shopify]);

  const handleDelete = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "delete");
    submit(formData, { method: "POST" });
    setDeleteModalOpen(false);
  }, [submit]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <Page
      backAction={{ content: "Bundle Rules", url: "/app/rules" }}
      title={`Edit: ${rule.bundleProductTitle}`}
    >
      <TitleBar title="Edit Bundle Rule">
        <button variant="primary" onClick={handleSave} disabled={isSaving}>
          Save
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {"error" in (actionData || {}) && (
          <Banner title="Error" tone="critical">
            <p>{(actionData as any).error}</p>
          </Banner>
        )}

        {"success" in (actionData || {}) && (
          <Banner title="Success" tone="success">
            <p>{(actionData as any).message}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              {/* Bundle Product Info */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      📦 Bundle Product
                    </Text>
                    <Badge tone="info">Read-only</Badge>
                  </InlineStack>
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="bold">
                        {rule.bundleProductTitle}
                      </Text>
                      {rule.bundleSku && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          SKU: {rule.bundleSku}
                        </Text>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">
                        Variant ID: {rule.bundleVariantId}
                      </Text>
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>

              {/* Base Product Info */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      🏷️ Base Product
                    </Text>
                    <Badge tone="info">Read-only</Badge>
                  </InlineStack>
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="bold">
                        {rule.baseProductTitle}
                      </Text>
                      {rule.baseSku && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          SKU: {rule.baseSku}
                        </Text>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">
                        Variant ID: {rule.baseVariantId}
                      </Text>
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>

              {/* Multiplier */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    ✖️ Multiplier
                  </Text>
                  <TextField
                    label="Units per bundle"
                    type="number"
                    value={multiplier}
                    onChange={setMultiplier}
                    min={1}
                    autoComplete="off"
                    helpText="How many base product units are deducted per bundle sold."
                  />
                </BlockStack>
              </Card>

              {/* Status Toggle */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        Rule Status
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {isActive
                          ? "This rule is actively syncing inventory."
                          : "This rule is paused. No inventory adjustments will be made."}
                      </Text>
                    </BlockStack>
                    <Button
                      onClick={() => setIsActive(!isActive)}
                      variant={isActive ? "primary" : "secondary"}
                    >
                      {isActive ? "Active ✓" : "Inactive"}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              {/* Stats */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Rule Info
                  </Text>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Created
                    </Text>
                    <Text as="span">{formatDate(rule.createdAt)}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Total syncs
                    </Text>
                    <Text as="span" fontWeight="bold">
                      {syncCount}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Status
                    </Text>
                    {isActive ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="new">Inactive</Badge>
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Danger Zone */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd" tone="critical">
                    Danger Zone
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Deleting this rule is permanent. Existing sync logs will be
                    preserved but future orders will not trigger inventory
                    adjustments.
                  </Text>
                  <Button
                    tone="critical"
                    variant="primary"
                    onClick={() => setDeleteModalOpen(true)}
                  >
                    Delete Rule
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete this bundle rule?"
        primaryAction={{
          content: "Delete permanently",
          destructive: true,
          onAction: handleDelete,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Are you sure you want to delete the rule for{" "}
              <strong>{rule.bundleProductTitle}</strong>?
            </Text>
            <Text as="p" tone="subdued">
              This action cannot be undone. Existing sync logs ({syncCount}{" "}
              records) will be preserved.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
