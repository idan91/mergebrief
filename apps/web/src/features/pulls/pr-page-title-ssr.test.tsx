// No jsdom: this renders the route the way the server does, to a string.
// The real root and the PR route's real loader and head run; only the PR
// page's component is a stub, so the Brief UI graph never loads.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildVersionQueryOptions } from "@web/features/version/queries";
import { VersionStates } from "@web/features/version/types";
import type { RouterContext } from "../../router";
import { Route as appRootRoute } from "../../routes/__root";
import { Route as appPrRoute } from "../../routes/repos.$repoId.pulls.$prNumber";
import { buildPrMetaQueryOptions } from "./queries";
import type { PrSummary } from "./types";

const REPO_ID = "424242";
const PR_NUMBER = 7;
const HOSTILE_TITLE = "</title><script>alert(1)</script>";

const waitingPr: PrSummary = {
  repoId: REPO_ID,
  repoSlug: "octo/hello",
  prNumber: PR_NUMBER,
  title: HOSTILE_TITLE,
  state: "open",
  headSha: "head-1",
  briefAvailable: false,
  draft: false,
  viewerIsAuthor: false,
  viewerCanResolve: false,
  viewerCanPush: false,
  appInstalled: true,
  behind: false,
  generation: {
    status: "pending",
    attempts: 0,
    updatedAt: "2026-07-06T12:00:00.000Z",
  },
  updatedAt: "2026-07-06T12:00:00.000Z",
};

/** The app's root, rebuilt so the real route tree stays untouched. */
const rootRoute = createRootRouteWithContext<RouterContext>()(
  appRootRoute.options as never,
);

const prRoute = createRoute({
  ...appPrRoute.options,
  getParentRoute: () => rootRoute,
  path: "/repos/$repoId/pulls/$prNumber",
  component: () => null,
} as never);

async function renderPrRouteToString(): Promise<string> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    buildPrMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
    waitingPr,
  );
  queryClient.setQueryData(buildVersionQueryOptions().queryKey, {
    kind: VersionStates.UNKNOWN,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([prRoute]),
    context: { queryClient },
    history: createMemoryHistory({
      initialEntries: [`/repos/${REPO_ID}/pulls/${PR_NUMBER}`],
    }),
  });
  await router.load();

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("PR brief tab title on the server render", () => {
  it("escapes markup in a PR title", async () => {
    const html = await renderPrRouteToString();

    expect(html).toContain(
      "<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; · #7 · octo/hello · MergeBrief</title>",
    );
    expect(html).not.toContain(HOSTILE_TITLE);
  });

  it("renders one title, the route's over the root's", async () => {
    const html = await renderPrRouteToString();
    const titleCount = html.split("<title>").length - 1;

    expect(titleCount).toBe(1);
    expect(html).not.toContain("<title>MergeBrief</title>");
  });
});
