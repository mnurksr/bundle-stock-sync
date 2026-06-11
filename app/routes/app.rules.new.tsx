import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useActionData, useNavigate, useSubmit, useFetcher } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
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
  List,
  Badge,
  Divider,
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
  const itemsJson = formData.get("items") as string;

  if (!bundleVariantId || !itemsJson) {
    return { error: "Please select a bundle product and at least one base item." };
  }

  let items: any[] = [];
  try {
    items = JSON.parse(itemsJson);
  } catch (e) {
    return { error: "Invalid items data." };
  }

  if (items.length === 0) {
    return { error: "You must add at least one base product to the bundle." };
  }

  // Ensure shop exists
  let shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    shop = await db.shop.create({ data: { shopDomain } });
  }

  // Enforce Free Plan Limits (max 3 rules)
  if (shop.plan === "free") {
    const currentRuleCount = await db.bundleRule.count({ where: { shopId: shop.id } });
    if (currentRuleCount >= 3) {
      return { error: "Free plan limit reached. You can only create up to 3 rules. Please upgrade to Pro." };
    }
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
      error: "A bundle rule already exists for this product variant. Please edit the existing rule instead.",
    };
  }

  // Resolve inventory item IDs for all items
  const resolvedItems = [];
  for (const item of items) {
    try {
      const inventoryItemId = await getInventoryItemId(admin, item.baseVariantId);
      if (!inventoryItemId) {
        return { error: `Could not find inventory item for ${item.baseProductTitle}. Ensure inventory tracking is enabled.` };
      }
      resolvedItems.push({ ...item, baseInventoryItemId: inventoryItemId });
    } catch (error: any) {
      return { error: `GraphQL Error fetching inventory item for ${item.baseProductTitle}: ${error.message}` };
    }
  }

  // Create bundle rule
  await db.bundleRule.create({
    data: {
      shopId: shop.id,
      bundleProductId,
      bundleVariantId,
      bundleProductTitle,
      bundleSku,
      items: {
        create: resolvedItems.map(item => ({
          baseProductId: item.baseProductId,
          baseVariantId: item.baseVariantId,
          baseProductTitle: item.baseProductTitle,
          baseSku: item.baseSku,
          baseInventoryItemId: item.baseInventoryItemId,
          quantity: item.quantity,
        })),
      },
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

interface BundleItem extends SelectedProduct {
  quantity: number;
}

export default function NewBundleRulePage() {
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const { t } = useTranslation();

  const [bundleProduct, setBundleProduct] = useState<SelectedProduct | null>(null);
  const [items, setItems] = useState<BundleItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const capacityFetcher = useFetcher();
  const [capacityData, setCapacityData] = useState<any>(null);

  useEffect(() => {
    if (bundleProduct?.variants[0]?.id && items.length > 0) {
      const formData = new FormData();
      formData.append("bundleVariantId", bundleProduct.variants[0].id);
      formData.append("items", JSON.stringify(
        items.map(item => ({
          baseVariantId: item.variants[0].id,
          quantity: item.quantity,
          title: item.title,
        }))
      ));
      capacityFetcher.submit(formData, { method: "POST", action: "/api/bundle-capacity" });
    } else {
      setCapacityData(null);
    }
  }, [bundleProduct, items]);

  useEffect(() => {
    if (capacityFetcher.data) {
      setCapacityData(capacityFetcher.data);
    }
  }, [capacityFetcher.data]);

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

  const addBaseProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "add",
    });

    if (selected && selected.length > 0) {
      const newItems = selected.map((product: any) => ({
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
        quantity: 1, // default quantity
      }));

      setItems((prev) => {
        const combined = [...prev];
        for (const newItem of newItems) {
          if (!combined.find((i) => i.variants[0].id === newItem.variants[0].id)) {
            combined.push(newItem);
          }
        }
        return combined;
      });
    }
  }, [shopify]);

  const updateItemQuantity = (variantId: string, quantityStr: string) => {
    const qty = parseInt(quantityStr, 10) || 1;
    setItems((prev) => prev.map((item) => (item.variants[0].id === variantId ? { ...item, quantity: qty } : item)));
  };

  const removeItem = (variantId: string) => {
    setItems((prev) => prev.filter((item) => item.variants[0].id !== variantId));
  };

  const handleSave = useCallback(() => {
    if (!bundleProduct || items.length === 0) return;

    setIsSaving(true);
    const bundleVariant = bundleProduct.variants[0];

    const payloadItems = items.map((item) => ({
      baseProductId: item.id,
      baseVariantId: item.variants[0].id,
      baseProductTitle: item.title,
      baseSku: item.variants[0].sku || "",
      quantity: item.quantity,
    }));

    const formData = new FormData();
    formData.append("bundleProductId", bundleProduct.id);
    formData.append("bundleVariantId", bundleVariant.id);
    formData.append("bundleProductTitle", bundleProduct.title);
    formData.append("bundleSku", bundleVariant.sku || "");
    formData.append("items", JSON.stringify(payloadItems));

    submit(formData, { method: "POST" });
  }, [bundleProduct, items, submit]);

  const bundleVariant = bundleProduct?.variants[0];
  const bundleStock = bundleVariant?.inventoryQuantity ?? 0;



  return (
    <Page backAction={{ content: t("rules_title"), url: "/app/rules" }} title={t("rules_new_title")}>
      <TitleBar title={t("rules_new_title")}>
        <button variant="primary" onClick={handleSave} disabled={isSaving || !bundleProduct || items.length === 0}>
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
                          <Thumbnail source={bundleProduct.images[0].originalSrc} alt={bundleProduct.title} size="medium" />
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

              {/* Base Products Selection */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("rules_new_base_title") || "Items inside the bundle"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("rules_new_base_desc") || "Select the individual products that make up this bundle and define their quantities."}
                  </Text>

                  {items.length > 0 && (
                    <BlockStack gap="300">
                      {items.map((item) => (
                        <Card key={item.variants[0].id}>
                          <InlineStack gap="400" align="start" blockAlign="center" wrap={false}>
                            {item.images?.[0] && (
                              <Thumbnail source={item.images[0].originalSrc} alt={item.title} size="small" />
                            )}
                            <div style={{ flexGrow: 1 }}>
                              <BlockStack gap="100">
                                <Text as="span" variant="bodyMd" fontWeight="bold">
                                  {item.title}
                                </Text>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  Variant: {item.variants[0]?.title}
                                </Text>
                              </BlockStack>
                            </div>
                            <div style={{ width: "80px" }}>
                              <TextField
                                labelHidden
                                label={t("rules_new_quantity")}
                                type="number"
                                value={String(item.quantity)}
                                onChange={(val) => updateItemQuantity(item.variants[0].id, val)}
                                min={1}
                                autoComplete="off"
                              />
                            </div>
                            <Button onClick={() => removeItem(item.variants[0].id)} tone="critical" variant="plain">
                              {t("rules_new_remove")}
                            </Button>
                          </InlineStack>
                        </Card>
                      ))}
                    </BlockStack>
                  )}

                  <Button onClick={addBaseProduct} variant="secondary" fullWidth>
                    {items.length > 0 ? t("rules_new_add_another") : t("rules_new_btn_select_base")}
                  </Button>
                </BlockStack>
              </Card>


            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              {/* Location Capacity */}
              {capacityData?.locations && capacityData.locations.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("rules_new_loc_capacity")}
                  </Text>
                  {capacityData.locations.map((loc: any) => (
                    <Card key={loc.locationId}>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodyMd" fontWeight="bold">
                            {loc.locationName}
                          </Text>
                          {!loc.isSafe ? (
                            <Badge tone="warning">{t("rules_new_oversell")}</Badge>
                          ) : loc.maxBundles === 0 ? (
                            <Badge>{t("rules_new_out_of_stock")}</Badge>
                          ) : (
                            <Badge tone="success">{t("rules_new_safe")}</Badge>
                          )}
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm" tone="subdued">{t("rules_new_max_bundles")}</Text>
                          <Text as="span" variant="bodySm" fontWeight="bold">{loc.maxBundles}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm" tone="subdued">{t("rules_new_current_stock")}</Text>
                          <Text as="span" variant="bodySm" fontWeight="bold">{loc.currentBundleStock}</Text>
                        </InlineStack>
                        <Divider />
                        {loc.items.map((item: any, i: number) => (
                          <InlineStack key={i} align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm" tone={item.stocked && item.available > 0 ? undefined : "subdued"}>
                              {item.title}
                            </Text>
                            <Text as="span" variant="bodySm" tone={item.stocked && item.available >= item.needed ? "success" : "critical"} fontWeight="bold">
                              {item.stocked ? `${item.available} ${t("rules_new_available")}` : t("rules_new_not_stocked")}
                            </Text>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              )}

              {/* Loading state */}
              {capacityFetcher.state === "submitting" && (
                <Card>
                  <Text as="p" variant="bodySm" tone="subdued">{t("rules_new_calculating")}</Text>
                </Card>
              )}

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("rules_new_how_title")}
                  </Text>
                  <List type="number">
                    <List.Item>{t("rules_new_how_1")}</List.Item>
                    <List.Item>{t("rules_new_how_2")}</List.Item>
                    <List.Item>{t("rules_new_how_3")}</List.Item>
                    <List.Item>{t("rules_new_how_4")}</List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
