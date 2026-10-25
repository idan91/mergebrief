// @vitest-environment jsdom
// Keep route tests in the owning feature to avoid file-based route generation.
// The real router uses seeded DB briefs with empty local artifacts;
// meta-only states exercise the waiting and failure cards.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { listRevisionRows, openRevisionsTab } from "@web/test/revisions";
import { omitFields } from "@web/test/fields";
import { routeTree } from "../../routeTree.gen";
import {
  buildDbBriefQueryOptions,
  buildDbComparisonMarksQueryOptions,
  buildDbDeltaQueryOptions,
  buildPrDiffQueryOptions,
  buildPrMetaQueryOptions,
} from "./queries";
import type { PrSummary } from "./types";
import type { Span } from "./utils";

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
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    viewerCanPush: false,
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

/** Every span the fixture brief answers for; `SPAN` always, older ones on request. */
async function renderRoute(
  metaValue: PrSummary,
  path: string,
  olderSpans: readonly Span[] = [],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    buildPrMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
    metaValue,
  );
  for (const span of [SPAN, ...olderSpans]) {
    queryClient.setQueryData(
      buildDbBriefQueryOptions(REPO_ID, PR_NUMBER, span.base, span.head)
        .queryKey,
      briefFixture,
    );
    queryClient.setQueryData(
      buildPrDiffQueryOptions(REPO_ID, PR_NUMBER, span.base, span.head)
        .queryKey,
      "",
    );
  }

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
  queryClient.setQueryData(
    buildDbComparisonMarksQueryOptions(
      REPO_ID,
      PR_NUMBER,
      "head-0",
      SPAN.head,
      "previous-brief",
      1,
    ).queryKey,
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
  it("renders the brief through BriefView with empty local artifacts", async () => {
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
    expect(screen.getByText(briefFixture.changeGroups[0]!.title)).toBeTruthy();
    await waitFor(() =>
      expect(document.title).toBe("t · #7 · octo/hello · MergeBrief"),
    );
    // The header's state badge on the DB route reads the LIVE webhook state
    // from the pr row (meta.state = open), never gated on the artifact's
    // stamped snapshot (this fixture predates stamping).
    expect(
      document
        .querySelector("[data-state-badge]")
        ?.getAttribute("data-variant"),
    ).toBe("open");
  });

  describe("conversation filter params", () => {
    const base = `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`;

    it("survives a thread deep link", async () => {
      const router = await renderRoute(
        meta({}),
        `${base}&thread=9001&reviewers=alice`,
      );
      await waitFor(() =>
        expect(
          screen.getByRole("heading", {
            level: 1,
            name: briefFixture.pr.title,
          }),
        ).toBeTruthy(),
      );
      expect(router.state.location.search.thread).toBe(9001);
      expect(router.state.location.search.reviewers).toBe("alice");
    });
  });

  it("shows the failed card with attempts and the sanitized error", async () => {
    await renderRoute(
      omitFields(
        meta({
          briefAvailable: false,
          generation: {
            status: "failed",
            attempts: 1,
            errorCode: "unknown",
            errorDetail: "model call failed",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
        }),
        "baseSha",
      ),
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

  it("normalizes a lone base or head instead of treating it as explicit", async () => {
    const router = await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=stale-only`,
    );
    // Renders the CURRENT span (from the meta), exactly like a span-less link…
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
    // …and the dangling key is ignored rather than resolved: no revision
    // list means no rev to pin, so nothing is written back.
    const search = router.state.location.search as {
      head?: string;
      rev?: number;
    };
    expect(search.head).toBeUndefined();
    expect(search.rev).toBeUndefined();
  });

  it("Compare explains each disabled baseline when the meta offers none", async () => {
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
    // Disabled options stay focusable (`aria-disabled`) with the reason in a
    // keyboard-reachable tooltip referenced by aria-describedby.
    const button = screen.getByRole("radio", { name: /^previous brief$/i });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const tooltipId = button.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    const tooltip = document.getElementById(tooltipId ?? "");
    expect(tooltip?.textContent).toMatch(/no previous brief/i);

    const lastReview = screen.getByRole("radio", {
      name: /^your last review$/i,
    });
    expect(lastReview.getAttribute("aria-disabled")).toBe("true");
    const lastReviewTooltip = document.getElementById(
      lastReview.getAttribute("aria-describedby") ?? "",
    );
    expect(lastReviewTooltip?.textContent).toMatch(
      /no submitted review checkpoint yet/i,
    );
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
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
    const button = screen.getByRole("radio", { name: /^previous brief$/i });
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect((button as HTMLInputElement).checked).toBe(true);
    void queryClient;
  });

  it("offers marks-only comparison and explains missing changes-only view", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const withLastReview = meta({
      comparisons: {
        lastReview: {
          kind: "available",
          deltaAvailable: false,
          baselineSha: "cp-1",
        },
      },
    });
    queryClient.setQueryData(
      buildPrMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
      withLastReview,
    );
    queryClient.setQueryData(
      buildDbBriefQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head)
        .queryKey,
      briefFixture,
    );
    queryClient.setQueryData(
      buildPrDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head)
        .queryKey,
      "",
    );
    queryClient.setQueryData(
      buildDbComparisonMarksQueryOptions(
        REPO_ID,
        PR_NUMBER,
        "cp-1",
        SPAN.head,
        "checkpoint",
        null,
      ).queryKey,
      {
        baselineSha: "cp-1",
        headSha: SPAN.head,
        baselineLabel: "checkpoint",
        files: [],
      },
    );
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({
        initialEntries: [
          `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}&compare=last-review&view=changes`,
        ],
      }),
    });
    await router.load();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const button = await waitFor(() =>
      screen.getByRole("radio", { name: /^your last review$/i }),
    );
    expect((button as HTMLInputElement).disabled).toBe(false);
    expect((button as HTMLInputElement).checked).toBe(true);
    // Marks-only tier: the changes pane degrades, no delta core to render.
    await waitFor(() =>
      expect(screen.getByText(/changes summary unavailable/i)).toBeTruthy(),
    );
  });

  it("renders the pre-warmed last-review delta when available", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      buildPrMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
      meta({
        comparisons: {
          lastReview: {
            kind: "available",
            deltaAvailable: true,
            baselineSha: "cp-1",
          },
        },
      }),
    );
    queryClient.setQueryData(
      buildDbBriefQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head)
        .queryKey,
      briefFixture,
    );
    queryClient.setQueryData(
      buildPrDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head)
        .queryKey,
      "",
    );
    queryClient.setQueryData(
      buildDbComparisonMarksQueryOptions(
        REPO_ID,
        PR_NUMBER,
        "cp-1",
        SPAN.head,
        "checkpoint",
        null,
      ).queryKey,
      {
        baselineSha: "cp-1",
        headSha: SPAN.head,
        baselineLabel: "checkpoint",
        files: [],
      },
    );
    // The delta core: same Brief shape, artifactKind "delta".
    queryClient.setQueryData(
      buildDbDeltaQueryOptions(REPO_ID, PR_NUMBER, "cp-1", SPAN.head).queryKey,
      {
        ...briefFixture,
        artifactKind: "delta",
        summary: "Fixture delta summary since your checkpoint.",
      },
    );
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({
        initialEntries: [
          `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}&compare=last-review&view=changes`,
        ],
      }),
    });
    await router.load();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    // The changes pane renders the DELTA core, not the degradation state.
    await waitFor(() =>
      expect(screen.getByText(/changes since your last review/i)).toBeTruthy(),
    );
    expect(
      screen.getByText(/fixture delta summary since your checkpoint/i),
    ).toBeTruthy();
    expect(screen.queryByText(/changes summary unavailable/i)).toBeNull();
  });

  it("explains a pending last-review checkpoint on the disabled radio", async () => {
    await renderRoute(
      meta({
        comparisons: { lastReview: { kind: "unavailable", reason: "pending" } },
      }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
    const button = screen.getByRole("radio", { name: /^your last review$/i });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const tooltip = document.getElementById(
      button.getAttribute("aria-describedby") ?? "",
    );
    expect(tooltip?.textContent).toMatch(/delta still generating/i);
  });

  it("offers head-advance navigation when pinned to an older span", async () => {
    await renderRoute(
      meta({ headSha: "head-9", baseSha: "base-9" }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^go to new brief$/i }),
      ).toBeTruthy(),
    );
    // Still pinned: the OLD span's brief renders behind the banner.
    expect(
      screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
    ).toBeTruthy();
    // The legacy (no-revisions) path carries the stale-submit ack too, the
    // gate is span-derived, not timeline-derived.
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));
    // The advisory view fronts the modal when unresolved items exist;
    // Continue reaches the verdict view, which carries the ack.
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(
      screen.getByText(/comments will anchor to the revision you reviewed/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", {
        name: /submit against the reviewed revision anyway/i,
      }),
    ).toBeTruthy();
  });

  it("shows the PR author from the meta on the header", async () => {
    await renderRoute(
      meta({ authorLogin: "mira-k" }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("banner")).getByTestId("author-chip")
          .textContent,
      ).toContain("mira-k"),
    );
  });

  it("own-draft on the current head: mark-ready is live", async () => {
    await renderRoute(
      meta({ draft: true, viewerIsAuthor: true }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    expect(
      within(screen.getByRole("banner")).getByText("Self-review: your draft"),
    ).toBeTruthy();
    const cta = screen.getByRole("button", { name: "Mark ready for review" });
    expect(cta.getAttribute("aria-disabled")).toBe("false");
  });
});

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/**
 * Build the route with a fetch stub, so a read the test leaves unseeded hits
 * the network (the shared `renderRoute` helper above seeds every query).
 */
async function renderRouteWithFetch(
  seed: (client: QueryClient) => void,
  fetchStub: (path: string) => Response,
  path: string,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = readRequestUrl(input);
      return Promise.resolve(fetchStub(url));
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  seed(queryClient);
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
  return { router, queryClient };
}

const PR_NOT_FOUND_HEADING = "This pull request isn't available.";

describe("DB brief route, explicit-span deep link while generating", () => {
  const generatingMeta = meta({
    briefAvailable: false,
    generation: {
      status: "running",
      phase: "generating",
      attempts: 0,
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
  });

  it("renders the arriving artifact without crashing on the cached 404", async () => {
    let briefReady = false;
    const { queryClient } = await renderRouteWithFetch(
      (client) => {
        client.setQueryData(
          buildPrMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
          generatingMeta,
        );
        client.setQueryData(
          buildPrDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head)
            .queryKey,
          "",
        );
      },
      (url) => {
        if (!url.includes("/brief")) {
          return new Response("{}", { status: 200 });
        }
        // Still generating on the deep-link load; the artifact lands later.
        return briefReady
          ? new Response(JSON.stringify(briefFixture), { status: 200 })
          : new Response("not found", { status: 404 });
      },
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    // The wait state renders (the swallowed 404), not the error boundary.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /generating the brief/i }),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/read the raw diff while you wait/i)).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: PR_NOT_FOUND_HEADING }),
    ).toBeNull();

    // Generation completes: the artifact becomes fetchable and the poll flips
    // briefAvailable → the route swaps to the render state and DbBrief mounts.
    briefReady = true;
    queryClient.setQueryData(
      buildPrMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
      meta({}),
    );

    // The Brief renders from a FRESH fetch, the evicted 404 does not resurface
    // as the error boundary.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/brief failed to load/i)).toBeNull();
  });

  it("renders not-found when PR metadata returns 404", async () => {
    await renderRouteWithFetch(
      () => {
        // Nothing seeded: BOTH meta and brief hit the network → 404. A meta
        // 404 must still 404 the page even on the explicit-span path.
      },
      () => new Response("not found", { status: 404 }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: PR_NOT_FOUND_HEADING }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByRole("heading", { name: /generating the brief/i }),
    ).toBeNull();
  });
});

describe("DB brief route, rev param", () => {
  const OLDER = { base: "base-0", head: "head-0" };
  const revisions = [
    {
      headSha: OLDER.head,
      baseSha: OLDER.base,
      headIndex: 1,
      createdAt: "2026-07-05T12:00:00.000Z",
      comparisons: {},
    },
    {
      headSha: SPAN.head,
      baseSha: SPAN.base,
      headIndex: 2,
      createdAt: "2026-07-06T12:00:00.000Z",
      comparisons: {},
    },
  ];

  function readSearch(router: Awaited<ReturnType<typeof renderRoute>>) {
    return router.state.location.search as {
      base?: string;
      head?: string;
      rev?: number;
      l?: string;
    };
  }

  it("a line pick writes the link param and keeps the rev", async () => {
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?rev=2`,
    );
    const cell = await waitFor(() => {
      const found = document.querySelector(
        'td[data-select-anchor][data-line-new="10"]',
      );
      if (!(found instanceof HTMLElement)) {
        throw new Error("no number cell");
      }
      return found;
    });
    const row = cell.closest("tr");
    if (row === null) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);

    await waitFor(() =>
      expect(readSearch(router)).toEqual({ rev: 2, l: "chunk-a.R10" }),
    );
    expect(router.history.location.href).toContain("?rev=2&l=chunk-a.R10");
  });

  it("rewrites a legacy span link to its rev and keeps the link", async () => {
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}&l=c1`,
    );
    await waitFor(() => expect(readSearch(router).rev).toBe(2));
    expect(readSearch(router).base).toBeUndefined();
    expect(readSearch(router).head).toBeUndefined();
    expect(readSearch(router).l).toBe("c1");
    expect(router.history.length).toBe(1);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
  });

  it("leaves an unknown rev in place, shows latest and the note", async () => {
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?rev=9`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(/that revision link is no longer available/i),
    ).toBeTruthy();
    expect(readSearch(router)).toEqual({ rev: 9 });
  });

  it("selecting a revision writes rev only, the link dropped", async () => {
    window.localStorage.clear();
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?rev=2&l=c1`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
    await openRevisionsTab();
    fireEvent.click(listRevisionRows()[0]!);
    await waitFor(() => expect(readSearch(router).rev).toBe(1));
    expect(readSearch(router).head).toBeUndefined();
    expect(readSearch(router).base).toBeUndefined();
    expect(readSearch(router).l).toBeUndefined();
  });

  it("going to the newest revision drops the link", async () => {
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?rev=1&l=c1`,
      [OLDER],
    );
    const goToNewBrief = await screen.findByRole("button", {
      name: /^go to new brief$/i,
    });
    fireEvent.click(goToNewBrief);
    // The pin effect writes the latest rev back; the link stays gone.
    await waitFor(() => expect(readSearch(router)).toEqual({ rev: 2 }));
  });

  it("drops the default view but keeps off on a Compare write", async () => {
    // `renderRoute` seeds no marks, so previous-brief resolves as available
    // from the meta alone; the radio is live and Off is a real change.
    const withComparison = meta({
      revisions: [
        revisions[0]!,
        {
          ...revisions[1]!,
          comparisons: {
            previousBrief: {
              baselineSha: OLDER.head,
              baselineIndex: 1,
              narrativeAvailable: false,
            },
          },
        },
      ],
    });
    const router = await renderRoute(
      withComparison,
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?rev=2&view=full&compare=previous-brief&l=c1`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("radio", { name: /^off$/i }));
    await waitFor(() =>
      expect(readSearch(router)).toEqual({ rev: 2, compare: "off", l: "c1" }),
    );
  });
});
