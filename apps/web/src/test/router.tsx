import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { useState, type ReactNode } from "react";

/**
 * Render a tree that uses router links or navigation: a memory router with
 * one screen at "/" holding the tree, plus a query client so query consumers
 * mount. `stubPaths` are empty routes a link inside the tree must resolve
 * against. The client and the router come back so a test can seed the cache
 * or read where a navigation went.
 */
export async function renderInRouter(
  tree: ReactNode,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
  stubPaths: readonly string[] = [],
  initialEntry = "/",
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
  const stubs = stubPaths.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => null,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([screen, ...stubs]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return { queryClient, router };
}

/**
 * The same router with a tree a test swaps in place, the way a refreshed
 * screen re-renders: the stage holds the tree and `update` replaces it.
 */
export async function renderStageInRouter(
  initial: ReactNode,
  stubPaths: readonly string[] = [],
): Promise<{
  update: (next: ReactNode) => void;
  router: Pick<AnyRouter, "state">;
}> {
  let setTree: ((next: ReactNode) => void) | undefined;
  function Stage() {
    const [tree, setState] = useState<ReactNode>(initial);
    setTree = setState;
    return <>{tree}</>;
  }
  const { router } = await renderInRouter(<Stage />, undefined, stubPaths);
  return {
    router,
    update: (next) => {
      act(() => {
        setTree?.(next);
      });
    },
  };
}
