import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { LanguageProvider, useTranslation } from "../utils/i18n";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  
  // Enforce plan selection on first load (Managed Pricing workflow)
  try {
    const response = await admin.graphql(`
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
          }
        }
      }
    `);
    
    const { data } = await response.json();
    const activeSubscriptions = data?.currentAppInstallation?.activeSubscriptions || [];
    
    if (activeSubscriptions.length === 0) {
      const shopHandle = session.shop.replace(".myshopify.com", "");
      throw redirect(`https://admin.shopify.com/store/${shopHandle}/charges/bundle-stock-sync-3/pricing_plans`, { target: "_top" });
    }
  } catch (error) {
    if (error instanceof Response) throw error; // Re-throw the redirect Response
    console.error("Failed to check active subscriptions:", error);
  }

  // Extract locale from request URL (Shopify passes it like ?locale=tr-TR or just tr)
  const url = new URL(request.url);
  const rawLocale = url.searchParams.get("locale") || "en";
  const localePrefix = rawLocale.split("-")[0].toLowerCase() as any; // e.g., 'tr'
  const supportedLocales = ["en", "tr", "de", "fr", "es"];
  const locale = supportedLocales.includes(localePrefix) ? localePrefix : "en";

  // Ensure shop is active on ANY app page load
  const shopDomain = session.shop;
  let shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    await db.shop.create({ data: { shopDomain, isActive: true } });
  } else if (!shop.isActive) {
    await db.shop.update({ where: { shopDomain }, data: { isActive: true } });
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "", locale };
};

function NavMenuTranslated() {
  const { t } = useTranslation();
  return (
    <NavMenu>
      <Link to="/app" rel="home">
        {t("nav_dashboard")}
      </Link>
      <Link to="/app/rules">{t("nav_rules")}</Link>
      <Link to="/app/logs">{t("nav_logs")}</Link>
      <Link to="/app/settings">{t("nav_settings")}</Link>
    </NavMenu>
  );
}

export default function App() {
  const { apiKey, locale } = useLoaderData<typeof loader>();

  return (
    <LanguageProvider locale={locale}>
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <NavMenuTranslated />
        <Outlet />
      </AppProvider>
    </LanguageProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
