import { Page, Layout, Card, Text, BlockStack, Link } from "@shopify/polaris";

export default function PrivacyPolicy() {
  return (
    <Page title="Privacy Policy">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Privacy Policy for Bundle Stock Sync</Text>
              <Text as="p">Last updated: June 2026</Text>
              
              <Text as="p">
                This Privacy Policy describes how your personal information is collected, used, and shared when you install or use the Bundle Stock Sync app in connection with your Shopify-supported store.
              </Text>

              <Text as="h3" variant="headingSm">Personal Information the App Collects</Text>
              <Text as="p">
                When you install the App, we are automatically able to access certain types of information from your Shopify account:
              </Text>
              <ul>
                <li>Shop domain and basic store information</li>
                <li>Product and variant details (inventory levels)</li>
                <li>Order details (only to adjust inventory when an order is paid)</li>
              </ul>
              <Text as="p">
                We do NOT collect, store, or process any Personal Identifiable Information (PII) of your customers (such as names, addresses, or payment details).
              </Text>

              <Text as="h3" variant="headingSm">How Do We Use Your Personal Information?</Text>
              <Text as="p">
                We use the information we collect to provide the App's core functionality: synchronizing inventory between bundle products and their base components.
              </Text>

              <Text as="h3" variant="headingSm">Your Rights</Text>
              <Text as="p">
                If you are a European resident, you have the right to access personal information we hold about you and to ask that your personal information be corrected, updated, or deleted. You can exercise this right by uninstalling the app, which will trigger an automated deletion request via Shopify.
              </Text>

              <Text as="h3" variant="headingSm">Contact Us</Text>
              <Text as="p">
                For more information about our privacy practices, if you have questions, or if you would like to make a complaint, please contact us by e-mail at <Link url="mailto:mnurksr@gmail.com">mnurksr@gmail.com</Link>.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
