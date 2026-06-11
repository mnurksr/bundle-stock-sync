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

  const [locationsMap, setLocationsMap] = useState<Record<string, string[]>>({});
  const locationsFetcher = useFetcher();

  useEffect(() => {
    const variantIdsToFetch: string[] = [];
    if (bundleProduct?.variants[0]?.id) {
      variantIdsToFetch.push(bundleProduct.variants[0].id);
    }
    items.forEach(item => {
      if (item.variants[0]?.id) variantIdsToFetch.push(item.variants[0].id);
    });

    const missingIds = variantIdsToFetch.filter(id => !locationsMap[id]);
    if (missingIds.length > 0) {
      const formData = new FormData();
      formData.append("variantIds", JSON.stringify(missingIds));
      locationsFetcher.submit(formData, { method: "POST", action: "/api/locations" });
    }
  }, [bundleProduct, items]);

  useEffect(() => {
    const data = locationsFetcher.data as any;
    if (data?.locations) {
      setLocationsMap(prev => ({ ...prev, ...data.locations }));
    }
  }, [locationsFetcher.data]);

  let mismatchedItems: string[] = [];
  const bundleLocations = bundleProduct?.variants[0]?.id ? locationsMap[bundleProduct.variants[0].id] : [];

  if (bundleLocations && bundleLocations.length > 0) {
    items.forEach(item => {
      const itemLocs = locationsMap[item.variants[0].id];
      if (itemLocs) {
        const hasIntersection = itemLocs.some(loc => bundleLocations.includes(loc));
        if (!hasIntersection) {
          mismatchedItems.push(item.title);
        }
      }
    });
  }

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

  // Calculate expected maximum bundles based on the bottleneck
  let expectedBundleStock = 0;
  if (items.length > 0) {
    expectedBundleStock = Math.min(
      ...items.map((item) => Math.floor((item.variants[0]?.inventoryQuantity || 0) / Math.max(1, item.quantity)))
    );
  }

  const oversellRisk = bundleProduct && items.length > 0 && bundleStock > expectedBundleStock;

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
                                label="Quantity"
                                type="number"
                                value={String(item.quantity)}
                                onChange={(val) => updateItemQuantity(item.variants[0].id, val)}
                                min={1}
                                autoComplete="off"
                              />
                            </div>
                            <Button onClick={() => removeItem(item.variants[0].id)} tone="critical" variant="plain">
                              Remove
                            </Button>
                          </InlineStack>
                        </Card>
                      ))}
                    </BlockStack>
                  )}

                  <Button onClick={addBaseProduct} variant="secondary" fullWidth>
                    {items.length > 0 ? "Add another item" : t("rules_new_btn_select_base")}
                  </Button>
                </BlockStack>
              </Card>


            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              {(oversellRisk || mismatchedItems.length > 0) && (
                <BlockStack gap="300">
                  {mismatchedItems.length > 0 && (
                    <Banner tone="critical" title="Location Mismatch">
                      <p>
                        The following base products are not stocked at any of the Bundle product's active locations:
                      </p>
                      <List type="bullet">
                        {mismatchedItems.map((name, i) => (
                          <List.Item key={i}>{name}</List.Item>
                        ))}
                      </List>
                      <p style={{ marginTop: "10px" }}>
                        Shopify will block inventory adjustments if base products aren't stocked at the bundle's location. Please activate them at the same location in Shopify Admin.
                      </p>
                    </Banner>
                  )}
                  {oversellRisk && (
                    <Banner tone="warning" title={t("rules_new_oversell_title")}>
                      <p>
                        {`The bundle stock (${bundleStock}) is higher than the maximum possible bundles (${expectedBundleStock}) you can make from the current base items' stock. This could lead to overselling.`}
                      </p>
                      <p style={{ marginTop: "10px" }}>{t("rules_new_oversell_desc2")}</p>
                    </Banner>
                  )}
                </BlockStack>
              )}

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("rules_new_how_title")}
                  </Text>
                  <List type="number">
                    <List.Item>Select the Bundle/Multipack product.</List.Item>
                    <List.Item>Add all the Base items contained in the bundle.</List.Item>
                    <List.Item>Specify how many of each base item goes into ONE bundle.</List.Item>
                    <List.Item>Save! Stock will sync automatically.</List.Item>
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
