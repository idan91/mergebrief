// @vitest-environment jsdom
// DB-brief route states through the real router (BRIEF-19 PR 3.2): a seeded
// cache renders the brief via BriefView with EMPTY local artifacts (the DB
// path's shape), and meta-only states render the wait/failed cards.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { briefFixture } from "../brief/fixtures";
import { routeTree } from "../../routeTree.gen";
import {
  dbBriefQueryOptions,
  dbComparisonMarksQueryOptions,
  prDiffQueryOptions,
  prMetaQueryOptions,
} from "./queries";
import type { PrSummary } from "./types";

const REPO_ID = "424242";
const PR_NUMBER = 7;
const SPAN = { base: "base-1", head: "head-1" };

function meta(overrides: Partial<PrSummary>): PrSummary {
  return {
    repoId: REPO_ID,
    repoSlug: "octo/hello",
    prNumber: PR_NUMBER,
    title: "t",
    state: "open",
    baseSha: SPAN.base,
    headSha: SPAN.head,
    briefAvailable: true,
    generation: {
      status: "succeeded",
      phase: null,
      attempts: 0,
      error: null,
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
    updatedAt: "2026-07-06T12:00:00.000Z",
    ...overrides,
  };
}

async function renderRoute(metaValue: PrSummary, path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
    metaValue,
  );
  queryClient.setQueryData(
    dbBriefQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
    briefFixture,
  );
  queryClient.setQueryData(
    prDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
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

/** Like renderRoute, but also seeds the previous-brief marks artifact. */
async function renderRouteWithMarks(metaValue: PrSummary, path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
    metaValue,
  );
  queryClient.setQueryData(
    dbBriefQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
    briefFixture,
  );
  queryClient.setQueryData(
    prDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
    "",
  );
  queryClient.setQueryData(
    dbComparisonMarksQueryOptions(REPO_ID, PR_NUMBER, "head-0", SPAN.head, 1)
      .queryKey,
    {
      baselineSha: "head-0",
      headSha: SPAN.head,
      baselineLabel: "previous-brief",
      baselineIndex: 1,
      files: [],
    },
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
  return queryClient;
}

describe("DB brief route", () => {
  afterEach(() => cleanup());

  it("renders the brief through BriefView with empty local artifacts", async () => {
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    expect(screen.getByText(briefFixture.changeGroups[0]!.title)).toBeTruthy();
  });

  it("shows the diff-first wait card while generation runs (no artifact yet)", async () => {
    await renderRoute(
      meta({
        briefAvailable: false,
        baseSha: null,
        generation: {
          status: "running",
          phase: "generating",
          attempts: 0,
          error: null,
          updatedAt: "2026-07-06T12:00:00.000Z",
        },
      }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: /generating the brief — generating/i,
        }),
      ).toBeTruthy(),
    );
  });

  it("shows the failed card with attempts and the sanitized error", async () => {
    await renderRoute(
      meta({
        briefAvailable: false,
        baseSha: null,
        generation: {
          status: "failed",
          phase: null,
          attempts: 1,
          error: "model call failed",
          updatedAt: "2026-07-06T12:00:00.000Z",
        },
      }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /brief generation failed/i }),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/model call failed/)).toBeTruthy();
    expect(screen.getByText(/2 attempts/)).toBeTruthy();
  });

  it("normalizes a partial span (lone base/head) instead of treating it as explicit", async () => {
    const router = await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=stale-only`,
    );
    // Renders the CURRENT span (from the meta), exactly like a span-less link…
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    // …and the dangling param is gone from the normalized search state (the
    // span-pinning replace then writes the full resolved span).
    await waitFor(() => {
      const search = router.state.location.search as {
        base?: string;
        head?: string;
      };
      expect(search.base).toBe(SPAN.base);
      expect(search.head).toBe(SPAN.head);
    });
  });

  it("Compare is disabled when the meta offers no previous-brief baseline", async () => {
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    const button = screen.getByRole("button", { name: /^previous brief$/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toMatch(/no previous brief/i);
  });

  it("Compare previous-brief activates from the URL when the meta offers it", async () => {
    const queryClient = await (async () => {
      const withComparison = meta({
        comparisons: {
          previousBrief: {
            baselineSha: "head-0",
            baselineIndex: 1,
            narrativeAvailable: false,
          },
        },
      });
      return renderRouteWithMarks(
        withComparison,
        `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}&compare=previous-brief&view=full`,
      );
    })();
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    const button = screen.getByRole("button", { name: /^previous brief$/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    void queryClient;
  });

  it("offers head-advance navigation when pinned to an older span", async () => {
    await renderRoute(
      meta({ headSha: "head-9", baseSha: "base-9" }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /go to the newest revision/i }),
      ).toBeTruthy(),
    );
    // Still pinned: the OLD span's brief renders behind the banner.
    expect(screen.getByText(briefFixture.pr.title)).toBeTruthy();
  });
});
