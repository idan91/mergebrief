import { useTranslation } from "react-i18next";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@web/components/Button";
import { PageError } from "@web/components/PageError";
import { NavigationProgress } from "@web/components/NavigationProgress";
import { buildPageTitle } from "@web/utils/pageTitle";
import {
  buildShareImageUrl,
  buildShareMeta,
  readPublicOrigin,
} from "@web/utils/share-image";
import { StatePage } from "@web/components/StatePage";
import {
  AccountMenu,
  useReloadOnViewerChange,
  useSyncViewerOnSignOut,
} from "@web/features/account";
import { appI18n, I18nProvider } from "../i18n/I18nProvider";
import type { RouterContext } from "../router";
import appStyles from "../styles/app.scss?url";
import monoBodyFont from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url";
import sansBodyFont from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url";

const THEME_COLOR = "#0a0a0c";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: ({ match }) => {
    const description = appI18n.t("shell.headMeta.description");
    const shareImageUrl = buildShareImageUrl(readPublicOrigin());
    const shareMeta = buildShareMeta(shareImageUrl);
    const title =
      // oxlint-disable-next-line no-underscore-dangle -- a global miss keeps status success; the router flags it only here
      match._notFound
        ? buildPageTitle(appI18n.t, [appI18n.t("shell.pageTitle.notFound")])
        : appI18n.t("shell.pageTitle.product");

    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { title },
        { name: "theme-color", content: THEME_COLOR },
        {
          name: "description",
          content: description,
        },
        {
          property: "og:title",
          content: "MergeBrief: understand a pull request before you review it",
        },
        {
          property: "og:description",
          content: description,
        },
        { property: "og:type", content: "website" },
        ...shareMeta,
      ],
      links: [
        {
          rel: "icon",
          href: "/favicon-16.png",
          type: "image/png",
          sizes: "16x16",
        },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        {
          rel: "preload",
          as: "font",
          type: "font/woff2",
          href: sansBodyFont,
          crossOrigin: "anonymous",
        },
        {
          rel: "preload",
          as: "font",
          type: "font/woff2",
          href: monoBodyFont,
          crossOrigin: "anonymous",
        },
        { rel: "stylesheet", href: appStyles },
      ],
    };
  },
  shellComponent: RootDocument,
  component: RootComponent,
  errorComponent: PageError,
  notFoundComponent: RootNotFound,
});

function RootComponent() {
  useSyncViewerOnSignOut();
  useReloadOnViewerChange();

  return (
    <I18nProvider>
      <NavigationProgress />
      <Outlet />
    </I18nProvider>
  );
}

/** An address no route matches; the PR route answers its own misses. */
function RootNotFound() {
  const { t } = useTranslation();

  return (
    <StatePage
      action={
        <Button as="a" href="/">
          {t("shell.notFound.home")}
        </Button>
      }
      heading={t("shell.notFound.heading")}
      headerEnd={<AccountMenu />}
    />
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useTranslation();

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <a className="skip-link" href="#main-content">
          {t("shell.skipToContent")}
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
