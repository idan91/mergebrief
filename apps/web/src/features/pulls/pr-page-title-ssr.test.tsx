// No jsdom: this renders the route the way the server does, to a string.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { routeTree } from "../../routeTree.gen";
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
  baseSha: null,
  headSha: "head-1",
  briefAvailable: false,
  draft: false,
  viewerIsAuthor: false,
  viewerCanResolve: false,
  appInstalled: true,
  behind: false,
  generation: {
    status: "pending",
    phase: null,
    attempts: 0,
    errorCode: null,
    errorDetail: null,
    updatedAt: "2026-07-06T12:00:00.000Z",
  },
  updatedAt: "2026-07-06T12:00:00.000Z",
};

async function renderPrRouteToString(): Promise<string> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    buildPrMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
    waitingPr,
  );

  const router = createRouter({
    routeTree,
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
    expect(html).not.toContain("MergeBrief / review</title>");
  });
});
