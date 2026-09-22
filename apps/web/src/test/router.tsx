import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Render a tree that uses router links or navigation: a memory router with
 * one screen at "/" holding the tree, plus a query client so query consumers
 * mount. The client and the router come back so a test can seed the cache
 * or read where a navigation went.
 */
export async function renderInRouter(
  tree: ReactNode,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
): Promise<{
  queryClient: QueryClient;
  router: Pick<AnyRouter, "state">;
}> {
  const rootRoute = createRootRoute();
  const screen = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screen]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return { queryClient, router };
}
