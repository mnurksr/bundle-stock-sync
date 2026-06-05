import { Page, Layout, Card, Text, BlockStack, Link } from "@shopify/polaris";

export default function TermsOfService() {
  return (
    <Page title="Terms of Service">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Terms of Service for Bundle Stock Sync</Text>
              <Text as="p">Last updated: June 2026</Text>
              
              <Text as="p">
                These Terms of Service ("Terms") govern your use of the Bundle Stock Sync application ("App"). By installing or using the App, you agree to these Terms.
              </Text>

              <Text as="h3" variant="headingSm">1. App Services</Text>
              <Text as="p">
                The App provides automated inventory synchronization for bundle products on your Shopify store. We strive to ensure 99.9% uptime, but we do not guarantee uninterrupted service.
              </Text>

              <Text as="h3" variant="headingSm">2. Pricing and Billing</Text>
              <Text as="p">
                The App offers a Free Plan with usage limits and a Pro Plan for unlimited usage. All billing is handled directly through Shopify's billing system. By upgrading to the Pro Plan, you agree to the recurring monthly charges as presented during the approval process.
              </Text>

              <Text as="h3" variant="headingSm">3. Limitation of Liability</Text>
              <Text as="p">
                In no event shall Bundle Stock Sync be liable for any direct, indirect, incidental, special, or consequential damages, including but not lost profits, loss of data, or inventory discrepancies resulting from the use or inability to use the App.
              </Text>

              <Text as="h3" variant="headingSm">4. Merchant Responsibilities</Text>
              <Text as="p">
                You are responsible for ensuring that your product configurations and bundle rules are correctly set up. We recommend verifying inventory levels periodically.
              </Text>

              <Text as="h3" variant="headingSm">Contact Us</Text>
              <Text as="p">
                If you have any questions about these Terms, please contact us at <Link url="mailto:support@bundlestocksync.com">support@bundlestocksync.com</Link>.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
