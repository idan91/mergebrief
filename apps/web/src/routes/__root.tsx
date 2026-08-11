import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Footer } from "@web/components/Footer/Footer";
import { I18nProvider } from "../i18n/I18nProvider";
import type { RouterContext } from "../router";
import appStyles from "../styles/app.scss?url";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
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
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
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
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
