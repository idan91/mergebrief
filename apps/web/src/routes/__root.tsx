import { useTranslation } from "react-i18next";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Footer } from "@web/components/Footer/Footer";
import { resolveSurface } from "@web/utils/surface";
import { I18nProvider } from "../i18n/I18nProvider";
import type { RouterContext } from "../router";
import appStyles from "../styles/app.scss?url";
import monoBodyFont from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url";
import sansBodyFont from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "MergeBrief / review" },
      {
        name: "description",
        content:
          "Open-source, self-hostable comprehension layer for code review. Turns a PR into a brief: categorized change-groups with plain-language summaries and risk-surface attributes. BYOK, no telemetry.",
      },
      {
        property: "og:title",
        content: "MergeBrief / review — a comprehension layer for code review",
      },
      {
        property: "og:description",
        content:
          "Turns a pull request into a brief: categorized change-groups, plain-language summaries, and risk-as-facts. Open-source, self-hostable, BYOK.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
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
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <I18nProvider>
        <Outlet />
        <Footer />
      </I18nProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useTranslation();
  const pathname = useRouterState({
    select: (routerState) => routerState.location.pathname,
  });
  const surface = resolveSurface(pathname);

  return (
    <html lang="en" data-surface={surface}>
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
