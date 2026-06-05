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
  Checkbox,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getInventoryItemId } from "../services/inventory.server";

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

  const syncImmediately = formData.get("syncImmediately") === "true";
  if (syncImmediately) {
    try {
      const queryResponse = await admin.graphql(
        `#graphql
        query getSyncData($baseId: ID!, $bundleId: ID!) {
          baseVariant: productVariant(id: $baseId) {
            inventoryItem {
              inventoryLevels(first: 50) {
                edges {
                  node {
                    location { id }
                    quantities(names: ["available"]) { quantity }
                  }
                }
              }
            }
          }
          bundleVariant: productVariant(id: $bundleId) {
            inventoryItem { id }
          }
        }`,
        { variables: { baseId: baseVariantId, bundleId: bundleVariantId } }
      );
      const data = await queryResponse.json();
      const bundleInventoryItemId = data.data?.bundleVariant?.inventoryItem?.id;
      const baseLevels = data.data?.baseVariant?.inventoryItem?.inventoryLevels?.edges || [];

      if (bundleInventoryItemId && baseLevels.length > 0) {
        for (const edge of baseLevels) {
          const locationId = edge.node.location.id;
          const available = edge.node.quantities[0]?.quantity || 0;
          const newBundleStock = Math.max(0, Math.floor(available / multiplier));

          await admin.graphql(
            `#graphql
            mutation setBundleStock($input: InventorySetOnHandQuantitiesInput!) {
              inventorySetOnHandQuantities(input: $input) {
                userErrors { message }
              }
            }`,
            {
              variables: {
                input: {
                  reason: "correction",
                  setQuantities: [
                    {
                      inventoryItemId: bundleInventoryItemId,
                      locationId,
                      quantity: newBundleStock,
                    },
                  ],
                },
              },
            }
          );
        }
      }
    } catch (e) {
      console.error("Failed to execute initial sync:", e);
    }
  }

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

  const [bundleProduct, setBundleProduct] = useState<SelectedProduct | null>(
    null
  );
  const [baseProduct, setBaseProduct] = useState<SelectedProduct | null>(null);
  const [multiplier, setMultiplier] = useState("5");
  const [syncImmediately, setSyncImmediately] = useState(true);
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
    formData.append("syncImmediately", String(syncImmediately));

    submit(formData, { method: "POST" });
  }, [bundleProduct, baseProduct, multiplier, submit]);

  return (
    <Page
      backAction={{ content: "Bundle Rules", url: "/app/rules" }}
      title="Create Bundle Rule"
    >
      <TitleBar title="Create Bundle Rule">
        <button variant="primary" onClick={handleSave} disabled={isSaving}>
          Save
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
                    📦 Bundle Product (Multipack)
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Select the multipack/bundle product that customers buy (e.g.
                    "5-Pack Socks")
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
                          Change
                        </Button>
                      </InlineStack>
                    </Card>
                  ) : (
                    <Button onClick={selectBundleProduct} variant="secondary" fullWidth>
                      Select Bundle Product
                    </Button>
                  )}
                </BlockStack>
              </Card>

              {/* Base Product Selection */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    🏷️ Base Product (Single/Master)
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Select the base product whose inventory should be deducted
                    (e.g. "Single Sock")
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
                          Change
                        </Button>
                      </InlineStack>
                    </Card>
                  ) : (
                    <Button onClick={selectBaseProduct} variant="secondary" fullWidth>
                      Select Base Product
                    </Button>
                  )}
                </BlockStack>
              </Card>

              {/* Multiplier */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    ✖️ Multiplier
                  </Text>
                  <TextField
                    label="How many base product units are in one bundle?"
                    type="number"
                    value={multiplier}
                    onChange={setMultiplier}
                    min={1}
                    autoComplete="off"
                    helpText="Example: If selling a 5-pack, set multiplier to 5. When 1 bundle is sold, 5 units will be deducted from the base product's inventory."
                  />
                </BlockStack>
              </Card>

              {/* Initial Sync */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    ⚡ Initial Sync
                  </Text>
                  <Checkbox
                    label="Sync bundle inventory immediately"
                    helpText="If checked, the bundle product's inventory will be immediately updated to match the base product's current inventory upon saving."
                    checked={syncImmediately}
                    onChange={setSyncImmediately}
                  />
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  How it works
                </Text>
                <List type="number">
                  <List.Item>
                    Select the <strong>bundle product</strong> (the multipack
                    customers buy)
                  </List.Item>
                  <List.Item>
                    Select the <strong>base product</strong> (the single item
                    whose stock should decrease)
                  </List.Item>
                  <List.Item>
                    Set the <strong>multiplier</strong> (how many base units per
                    bundle)
                  </List.Item>
                  <List.Item>
                    When a customer buys the bundle, the app automatically
                    deducts <em>quantity × multiplier</em> from the base
                    product's inventory
                  </List.Item>
                </List>
                <Banner tone="info">
                  <p>
                    <strong>Example:</strong> Customer buys 2× "5-Pack Socks".
                    The app deducts 2 × 5 = <strong>10 units</strong> from
                    "Single Sock" inventory.
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
