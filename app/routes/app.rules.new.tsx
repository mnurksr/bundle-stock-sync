import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useActionData, useNavigate, useSubmit } from "@remix-run/react";
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
  Thumbnail,
  Box,
  List,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getInventoryItemId } from "../services/inventory.server";
import { useTranslation } from "../utils/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();

  const bundleProductId = formData.get("bundleProductId") as string;
  const bundleVariantId = formData.get("bundleVariantId") as string;
  const bundleProductTitle = formData.get("bundleProductTitle") as string;
  const bundleSku = (formData.get("bundleSku") as string) || null;
  const baseProductId = formData.get("baseProductId") as string;
  const baseVariantId = formData.get("baseVariantId") as string;
  const baseProductTitle = formData.get("baseProductTitle") as string;
  const baseSku = (formData.get("baseSku") as string) || null;
  const multiplier = parseInt(formData.get("multiplier") as string, 10) || 1;

  // Validate
  if (!bundleVariantId || !baseVariantId) {
    return {
      error: "Please select both a bundle product and a base product.",
    };
  }

  if (multiplier < 1) {
    return { error: "Multiplier must be at least 1." };
  }

  // Get inventoryItemId from Shopify API
  let inventoryItemId: string | null = null;
  try {
    inventoryItemId = await getInventoryItemId(admin, baseVariantId);
  } catch (error: any) {
    console.error("GraphQL Error:", error);
    let errorStr = "Unknown error";
    if (error instanceof Error) {
      errorStr = error.message;
    } else if (error && typeof error.status === 'number') {
      // It's likely a Response object
      errorStr = `HTTP ${error.status} ${error.statusText}`;
      try {
        const text = await (error as Response).clone().text();
        errorStr += ` - ${text}`;
      } catch (e) {}
    } else {
      try {
        errorStr = JSON.stringify(error);
      } catch (e) {}
    }

    return {
      error: `GraphQL Exception: ${errorStr} (Variant ID: ${baseVariantId})`,
    };
  }

  if (!inventoryItemId) {
    return {
      error:
        "Could not find inventory item for the base product. Make sure the product has inventory tracking enabled.",
    };
  }

  // Ensure shop exists
  let shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    shop = await db.shop.create({ data: { shopDomain } });
  }

  // Check if rule already exists for this variant
  const existingRule = await db.bundleRule.findUnique({
    where: {
      shopId_bundleVariantId: {
        shopId: shop.id,
        bundleVariantId,
      },
    },
  });

  if (existingRule) {
    return {
      error:
        "A bundle rule already exists for this product variant. Please edit the existing rule instead.",
    };
  }

  // Create bundle rule
  await db.bundleRule.create({
    data: {
      shopId: shop.id,
      bundleProductId,
      bundleVariantId,
      bundleProductTitle,
      bundleSku,
      baseProductId,
      baseVariantId,
      baseProductTitle,
      baseSku,
      baseInventoryItemId: inventoryItemId,
      multiplier,
    },
  });

  return redirect("/app/rules");
};

interface SelectedProduct {
  id: string;
  title: string;
  variants: Array<{
    id: string;
    title: string;
    sku: string;
    displayName: string;
    inventoryQuantity: number;
  }>;
  images?: Array<{
    originalSrc: string;
  }>;
}

export default function NewBundleRulePage() {
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const { t } = useTranslation();

  const [bundleProduct, setBundleProduct] = useState<SelectedProduct | null>(
    null
  );
  const [baseProduct, setBaseProduct] = useState<SelectedProduct | null>(null);
  const [multiplier, setMultiplier] = useState("5");
  const [isSaving, setIsSaving] = useState(false);

  const selectBundleProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
      action: "select",
    });

    if (selected && selected.length > 0) {
      const product = selected[0];
      setBundleProduct({
        id: product.id,
        title: product.title,
        variants: product.variants.map((v: any) => ({
          id: v.id,
          title: v.title,
          sku: v.sku || "",
          displayName: v.displayName || v.title,
          inventoryQuantity: v.inventoryQuantity || 0,
        })),
        images: product.images,
      });
    }
  }, [shopify]);

  const selectBaseProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
      action: "select",
    });

    if (selected && selected.length > 0) {
      const product = selected[0];
      setBaseProduct({
        id: product.id,
        title: product.title,
        variants: product.variants.map((v: any) => ({
          id: v.id,
          title: v.title,
          sku: v.sku || "",
          displayName: v.displayName || v.title,
          inventoryQuantity: v.inventoryQuantity || 0,
        })),
        images: product.images,
      });
    }
  }, [shopify]);

  const handleSave = useCallback(() => {
    if (!bundleProduct || !baseProduct) return;

    setIsSaving(true);
    const bundleVariant = bundleProduct.variants[0];
    const baseVariant = baseProduct.variants[0];

    const formData = new FormData();
    formData.append("bundleProductId", bundleProduct.id);
    formData.append("bundleVariantId", bundleVariant.id);
    formData.append("bundleProductTitle", bundleProduct.title);
    formData.append("bundleSku", bundleVariant.sku || "");
    formData.append("baseProductId", baseProduct.id);
    formData.append("baseVariantId", baseVariant.id);
    formData.append("baseProductTitle", baseProduct.title);
    formData.append("baseSku", baseVariant.sku || "");
    formData.append("multiplier", multiplier);

    submit(formData, { method: "POST" });
  }, [bundleProduct, baseProduct, multiplier, submit]);

  const bundleVariant = bundleProduct?.variants[0];
  const baseVariant = baseProduct?.variants[0];
  const parsedMultiplier = parseInt(multiplier, 10) || 1;
  const bundleStock = bundleVariant?.inventoryQuantity ?? 0;
  const baseStock = baseVariant?.inventoryQuantity ?? 0;
  
  const expectedBundleStock = Math.floor(baseStock / parsedMultiplier);
  const oversellRisk = bundleProduct && baseProduct && (bundleStock > expectedBundleStock);

  return (
    <Page
      backAction={{ content: t("rules_title"), url: "/app/rules" }}
      title={t("rules_new_title")}
    >
      <TitleBar title={t("rules_new_title")}>
        <button variant="primary" onClick={handleSave} disabled={isSaving}>
          {t("rules_btn_save")}
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {actionData?.error && (
          <Banner title="Error" tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              {/* Bundle Product Selection */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("rules_new_bundle_title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("rules_new_bundle_desc")}
                  </Text>

                  {bundleProduct ? (
                    <Card>
                      <InlineStack gap="400" align="start" blockAlign="center">
                        {bundleProduct.images?.[0] && (
                          <Thumbnail
                            source={bundleProduct.images[0].originalSrc}
                            alt={bundleProduct.title}
                            size="medium"
                          />
                        )}
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd" fontWeight="bold">
                            {bundleProduct.title}
                          </Text>
                          {bundleProduct.variants[0]?.sku && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              SKU: {bundleProduct.variants[0].sku}
                            </Text>
                          )}
                          <Text as="span" variant="bodySm" tone="subdued">
                            Variant: {bundleProduct.variants[0]?.title}
                          </Text>
                        </BlockStack>
                        <Button onClick={selectBundleProduct} size="slim">
                          {t("rules_new_btn_change")}
                        </Button>
                      </InlineStack>
                    </Card>
                  ) : (
                    <Button onClick={selectBundleProduct} variant="secondary" fullWidth>
                      {t("rules_new_btn_select_bundle")}
                    </Button>
                  )}
                </BlockStack>
              </Card>

              {/* Base Product Selection */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("rules_new_base_title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("rules_new_base_desc")}
                  </Text>

                  {baseProduct ? (
                    <Card>
                      <InlineStack gap="400" align="start" blockAlign="center">
                        {baseProduct.images?.[0] && (
                          <Thumbnail
                            source={baseProduct.images[0].originalSrc}
                            alt={baseProduct.title}
                            size="medium"
                          />
                        )}
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd" fontWeight="bold">
                            {baseProduct.title}
                          </Text>
                          {baseProduct.variants[0]?.sku && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              SKU: {baseProduct.variants[0].sku}
                            </Text>
                          )}
                          <Text as="span" variant="bodySm" tone="subdued">
                            Variant: {baseProduct.variants[0]?.title}
                          </Text>
                        </BlockStack>
                        <Button onClick={selectBaseProduct} size="slim">
                          {t("rules_new_btn_change")}
                        </Button>
                      </InlineStack>
                    </Card>
                  ) : (
                    <Button onClick={selectBaseProduct} variant="secondary" fullWidth>
                      {t("rules_new_btn_select_base")}
                    </Button>
                  )}
                </BlockStack>
              </Card>

              {/* Multiplier */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("rules_new_multi_title")}
                  </Text>
                  <TextField
                    label={t("rules_new_multi_label")}
                    type="number"
                    value={multiplier}
                    onChange={setMultiplier}
                    min={1}
                    autoComplete="off"
                    helpText={t("rules_new_multi_help")}
                  />
                </BlockStack>
              </Card>

              {/* Oversell Warning */}
              {oversellRisk && (
                <Banner tone="warning" title={t("rules_new_oversell_title")}>
                  <p>
                    {t("rules_new_oversell_desc1", { bundleStock, baseStock, multiplier: parsedMultiplier, expected: expectedBundleStock })}
                  </p>
                  <p style={{ marginTop: '10px' }}>
                    {t("rules_new_oversell_desc2")}
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("rules_new_how_title")}
                </Text>
                <List type="number">
                  <List.Item>
                    {t("rules_new_how_1")}
                  </List.Item>
                  <List.Item>
                    {t("rules_new_how_2")}
                  </List.Item>
                  <List.Item>
                    {t("rules_new_how_3")}
                  </List.Item>
                  <List.Item>
                    {t("rules_new_how_4")}
                  </List.Item>
                </List>
                <Banner tone="info">
                  <p>
                    {t("rules_new_how_example")}
                  </p>
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
