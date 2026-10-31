// No jsdom: this renders the way the server does, dehydration included.
import { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import {
  createRequestHandler,
  defaultRenderHandler,
} from "@tanstack/react-router/ssr/server";
import { ApiErrorCodes } from "contract";
import { describe, expect, it } from "vitest";

import { PageError } from "./components/PageError";
import { ApiError } from "./data/apiFetch";
import { appI18n } from "./i18n/I18nProvider";
import { Route as appRootRoute } from "./routes/__root";
import { getRouter, type RouterContext } from "./router";
import { startInstance } from "./start";

const REQUEST_PATH = "/api/repos/424242/pulls/7/brief?base=private-base";

/** The app's root, rebuilt so the real route tree stays untouched. */
const rootRoute = createRootRouteWithContext<RouterContext>()(
  appRootRoute.options as never,
);

const failingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/failing",
  loader: () => {
    throw new ApiError(ApiErrorCodes.INTERNAL_ERROR, 500, REQUEST_PATH);
  },
  component: () => null,
});

const brokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/broken",
  loader: () => {
    throw new TypeError(`failed reading ${REQUEST_PATH}`);
  },
  component: () => null,
});

async function renderFailingRoute(path = "/failing"): Promise<string> {
  const { serializationAdapters } = await startInstance.getOptions();
  const handle = createRequestHandler({
    request: new Request(`http://localhost${path}`),
    createRouter: () => {
      const queryClient = new QueryClient();
      const router = createRouter({
        routeTree: rootRoute.addChildren([failingRoute, brokenRoute]),
        context: { queryClient },
        defaultErrorComponent: PageError,
      });
      // As Start's handler does: the start instance's adapters reach the router here.
      router.update({ ...router.options, serializationAdapters } as never);
      setupRouterSsrQueryIntegration({ router, queryClient });
      return router;
    },
  });
  const response = await handle(defaultRenderHandler);

  return response.text();
}

describe("an error no route boundary catches, on the server render", () => {
  it("is the router's default error screen", () => {
    expect(getRouter().options.defaultErrorComponent).toBe(PageError);
    expect(appRootRoute.options.errorComponent).toBe(PageError);
  });

  it("renders curated copy inside the document", async () => {
    const html = await renderFailingRoute();

    expect(html).toContain("<html");
    expect(html).toContain(appI18n.t("shell.pageFailed.heading"));
  });

  it("ships neither the message nor the request path", async () => {
    const html = await renderFailingRoute();

    expect(html).toContain("api-error");
    expect(html).not.toContain("api request failed");
    expect(html).not.toContain("/api/repos/424242");
    expect(html).not.toContain("private-base");
  });

  it("ships no other error's message", async () => {
    const html = await renderFailingRoute("/broken");

    expect(html).toContain(appI18n.t("shell.pageFailed.heading"));
    expect(html).not.toContain("failed reading");
    expect(html).not.toContain("/api/repos/424242");
  });
});
