// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { omitFields } from "@web/test/fields";
import { routeTree } from "../../routeTree.gen";
import {
  buildDbBriefQueryOptions,
  buildPrDiffQueryOptions,
  buildPrMetaQueryOptions,
} from "./queries";
import type { PrSummary } from "./types";

const REPO_ID = "424242";
const PR_NUMBER = 7;
const SPAN = { base: "base-1", head: "head-1" };
const PR_PATH = `/repos/${REPO_ID}/pulls/${PR_NUMBER}`;

function makeMeta(overrides: Partial<PrSummary>): PrSummary {
  return {
    repoId: REPO_ID,
    repoSlug: "octo/hello",
    prNumber: PR_NUMBER,
    title: "Fix the login redirect",
    state: "open",
    baseSha: SPAN.base,
    headSha: SPAN.head,
    briefAvailable: true,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    appInstalled: true,
    behind: false,
    generation: {
      status: "succeeded",
      attempts: 0,
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
    updatedAt: "2026-07-06T12:00:00.000Z",
    ...overrides,
  };
}

async function loadPrRoute(metaValue: PrSummary, path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    buildPrMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
    metaValue,
  );
  queryClient.setQueryData(
    buildDbBriefQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
    briefFixture,
  );
  queryClient.setQueryData(
    buildPrDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
    "",
  );

  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
}

describe("PR brief tab title", () => {
  it("leads with the PR title, then number and repo", async () => {
    await loadPrRoute(makeMeta({}), PR_PATH);

    await waitFor(() => {
      expect(document.title).toBe(
        "Fix the login redirect · #7 · octo/hello · MergeBrief",
      );
    });
  });

  it("titles a revision opened by an explicit span", async () => {
    const spanPath = `${PR_PATH}?base=${SPAN.base}&head=${SPAN.head}`;
    await loadPrRoute(makeMeta({}), spanPath);

    await waitFor(() => {
      expect(document.title).toBe(
        "Fix the login redirect · #7 · octo/hello · MergeBrief",
      );
    });
  });

  it("titles a PR that has no brief yet", async () => {
    const waiting = omitFields(
      makeMeta({ briefAvailable: false }),
      "title",
      "baseSha",
    );
    await loadPrRoute(waiting, PR_PATH);

    await waitFor(() => {
      expect(document.title).toBe("#7 · octo/hello · MergeBrief");
    });
  });
});
