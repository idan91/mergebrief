import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { PageError } from "./components/PageError";
import { routeTree } from "./routeTree.gen";
import { parseRouteSearch } from "./utils/search-params";

export interface RouterContext {
  queryClient: QueryClient;
}

export function getRouter() {
  // Every read maps a failure to a state or a typed error the screen renders;
  // a silent retry would hide a 4xx behind a spinner.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
    parseSearch: parseRouteSearch,
    defaultErrorComponent: PageError,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
