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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/fixtures";
import { routeTree } from "../../routeTree.gen";
import {
  buildDbBriefQueryOptions,
  buildDbComparisonMarksQueryOptions,
  buildDbDeltaQueryOptions,
  buildPrDiffQueryOptions,
  buildPrMetaQueryOptions,
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
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    behind: false,
    generation: {
      status: "succeeded",
      phase: null,
      attempts: 0,
      errorCode: null,
      errorDetail: null,
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
    // The header's state badge on the DB route reads the LIVE webhook state
    // from the pr row (meta.state = open), never gated on the artifact's
    // stamped snapshot (this fixture predates stamping).
    expect(
      document
        .querySelector("[data-state-badge]")
        ?.getAttribute("data-variant"),
    ).toBe("open");
  });

  // The filter is URL state, so validateSearch and the chip write are the
  // contract. Nothing else pins that clearing a family removes its key, or
  // that the revision/thread params survive a filter write.
  describe("conversation filter params", () => {
    const base = `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`;

    it("canonicalizes the filter params and drops unknown tokens", async () => {
      const router = await renderRoute(
        meta({}),
        `${base}&verdicts=nonsense,changes-requested,dismissed&reviewers=alice&reviews=all`,
      );
      await waitFor(() =>
        expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
      );
      const search = router.state.location.search;
      expect(search.verdicts).toBe("changes-requested");
      expect(search.reviewers).toBe("alice");
      expect(search.reviews).toBe("all");
      // Idempotent: navigating to the canonical form must not churn it (a
      // non-idempotent projection would loop the router).
      await router.navigate({ to: router.state.location.pathname, search });
      await waitFor(() =>
        expect(router.state.location.search.verdicts).toBe("changes-requested"),
      );
      expect(router.state.location.search.reviewers).toBe("alice");
    });

    it("keeps the span params and defaults the filter keys away", async () => {
      const router = await renderRoute(meta({}), base);
      await waitFor(() =>
        expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
      );
      const search = router.state.location.search;
      expect(search.base).toBe(SPAN.base);
      expect(search.head).toBe(SPAN.head);
      expect(search.verdicts).toBeUndefined();
      expect(search.reviewers).toBeUndefined();
      expect(search.reviews).toBeUndefined();
    });

    it("survives a thread deep link", async () => {
      const router = await renderRoute(
        meta({}),
        `${base}&thread=9001&reviewers=alice`,
      );
      await waitFor(() =>
        expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
      );
      expect(router.state.location.search.thread).toBe(9001);
      expect(router.state.location.search.reviewers).toBe("alice");
    });
  });

  it("shows a diff-first wait card before the generated artifact exists", async () => {
    await renderRoute(
      meta({
        briefAvailable: false,
        baseSha: null,
        generation: {
          status: "running",
          phase: "fetching",
          attempts: 0,
          errorCode: null,
          errorDetail: null,
          updatedAt: "2026-07-06T12:00:00.000Z",
        },
      }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}`,
    );
    // A phase whose line differs from the generic fallback, so a phase that
    // never reaches the card fails here.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Fetching the pull request…" }),
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
          errorCode: "unknown",
          errorDetail: "model call failed",
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

  it("normalizes a lone base or head instead of treating it as explicit", async () => {
    const router = await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=stale-only`,
    );
    // Renders the CURRENT span (from the meta), exactly like a span-less link…
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
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

  it("Compare is disabled when the meta offers no previous-brief baseline", async () => {
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    // Disabled options stay focusable (`aria-disabled`) with the reason in a
    // keyboard-reachable tooltip referenced by aria-describedby.
    const button = screen.getByRole("radio", { name: /^previous brief$/i });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const tooltipId = button.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    const tooltip = document.getElementById(tooltipId ?? "");
    expect(tooltip?.textContent).toMatch(/no previous brief/i);
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
        baselineIndex: null,
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
        baselineIndex: null,
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
      expect(
        screen.getByText(/changes only · since your last review/i),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(/fixture delta summary since your checkpoint/i),
    ).toBeTruthy();
    expect(screen.queryByText(/changes summary unavailable/i)).toBeNull();
  });

  it("allows turning off default comparison from Full Brief", async () => {
    // A returning reviewer defaults into changes+last-review; after clicking
    // Full Brief the compare stays active, Off must exist to reach full+off.
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}&view=full&compare=off`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    const off = screen.getByRole("radio", { name: /^off$/i });
    expect((off as HTMLButtonElement).disabled).toBe(false);
    expect((off as HTMLInputElement).checked).toBe(true);
  });

  it("explains why last-review comparison is disabled for each tier", async () => {
    const cases = [
      { reason: "pending", copy: /delta still generating/i },
      {
        reason: "baseline-unavailable",
        copy: /history rewritten since your last review/i,
      },
    ] as const;
    for (const { reason, copy } of cases) {
      cleanup();
      await renderRoute(
        meta({
          comparisons: { lastReview: { kind: "unavailable", reason } },
        }),
        `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
      );
      await waitFor(() =>
        expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
      );
      const button = screen.getByRole("radio", {
        name: /^your last review$/i,
      });
      expect(button.getAttribute("aria-disabled")).toBe("true");
      const tooltip = document.getElementById(
        button.getAttribute("aria-describedby") ?? "",
      );
      expect(tooltip?.textContent).toMatch(copy);
    }
  });

  it("uses never-submitted copy when comparison availability is absent", async () => {
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    const button = screen.getByRole("radio", { name: /^your last review$/i });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const tooltip = document.getElementById(
      button.getAttribute("aria-describedby") ?? "",
    );
    expect(tooltip?.textContent).toMatch(/no submitted review checkpoint yet/i);
  });

  it("offers head-advance navigation when pinned to an older span", async () => {
    await renderRoute(
      meta({ headSha: "head-9", baseSha: "base-9" }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /newer commits/i }),
      ).toBeTruthy(),
    );
    // Still pinned: the OLD span's brief renders behind the banner.
    expect(screen.getByText(briefFixture.pr.title)).toBeTruthy();
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

  it("own-draft on the current head: mark-ready is live", async () => {
    await renderRoute(
      meta({ draft: true, viewerIsAuthor: true }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    expect(screen.getByText("Self-review — your draft")).toBeTruthy();
    const cta = screen.getByRole("button", { name: "Mark ready for review" });
    expect(cta.getAttribute("aria-disabled")).toBe("false");
  });

  it("labels historical own drafts without mark-ready or its gate", async () => {
    // The PR's head moved on; the viewer is pinned to the older span.
    await renderRoute(
      meta({
        draft: true,
        viewerIsAuthor: true,
        headSha: "head-9",
        baseSha: "base-9",
      }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    // The PR is still the viewer's draft, the state label follows STATE,
    // not the revision on screen.
    expect(screen.getByText("Self-review — your draft")).toBeTruthy();
    // But mark-ready is head-scoped: the gate would list THIS revision's
    // flags, not the current head's, so the action reads disabled (still
    // focusable) and a click explains itself instead of gating on stale
    // flags. Nothing gate-shaped exists in the DOM.
    const cta = screen.getByRole("button", { name: "Mark ready for review" });
    expect(cta.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText("Before marking ready")).toBeNull();
    fireEvent.click(cta);
    expect(
      await screen.findByText(/switch to the latest revision to mark/i),
    ).toBeTruthy();
    expect(screen.queryByText("Before marking ready")).toBeNull();
  });
});

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Build the route with a fetch stub and a recognizable not-found component, so
 * a loader `notFound()` is observable in the DOM (the shared `renderRoute`
 * helper above seeds every query and configures no not-found component).
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
    defaultNotFoundComponent: () => <div data-testid="nf">Not Found</div>,
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

describe("DB brief route, explicit-span deep link while generating", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const generatingMeta = meta({
    briefAvailable: false,
    generation: {
      status: "running",
      phase: "generating",
      attempts: 0,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
  });

  it("shows the wait state for an explicit-span brief 404 while generating", async () => {
    await renderRouteWithFetch(
      (client) => {
        // Meta is seeded (present): the loader resolves it from cache and only
        // the still-generating brief hits the network → 404.
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
      (url) =>
        url.includes("/brief")
          ? new Response("not found", { status: 404 })
          : new Response("{}", { status: 200 }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    // The wait card renders exactly like a span-unknown generating load: the
    // generation status heading + the diff-first "read the raw diff" copy.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /generating the brief/i }),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/read the raw diff while you wait/i)).toBeTruthy();
    // Crucially NOT the router's not-found page.
    expect(screen.queryByTestId("nf")).toBeNull();
  });

  it("leaves no cached brief after a generating-brief 404", async () => {
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
      (url) =>
        url.includes("/brief")
          ? new Response("not found", { status: 404 })
          : new Response("{}", { status: 200 }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /generating the brief/i }),
      ).toBeTruthy(),
    );
    // ensureQueryData wrote an ERROR entry for the brief key; the loader must
    // evict it so a later render-state mount refetches instead of throwing the
    // cached error. No entry (neither data nor error) must remain.
    expect(
      queryClient.getQueryState(
        buildDbBriefQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head)
          .queryKey,
      ),
    ).toBeUndefined();
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
        if (!url.includes("/brief")) return new Response("{}", { status: 200 });
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
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
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
    await waitFor(() => expect(screen.getByTestId("nf")).toBeTruthy());
    expect(
      screen.queryByRole("heading", { name: /generating the brief/i }),
    ).toBeNull();
  });
});

describe("DB brief route, rev param", () => {
  afterEach(() => cleanup());

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
    };
  }

  it("renders the revision a rev names and leaves the URL as it came", async () => {
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?rev=2`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    expect(readSearch(router)).toEqual({ rev: 2 });
  });

  it("rewrites a legacy span link to its rev and keeps the hash", async () => {
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}#chunk-c1`,
    );
    await waitFor(() => expect(readSearch(router).rev).toBe(2));
    expect(readSearch(router).base).toBeUndefined();
    expect(readSearch(router).head).toBeUndefined();
    expect(router.state.location.hash).toBe("chunk-c1");
    expect(router.history.length).toBe(1);
    expect(screen.getByText(briefFixture.pr.title)).toBeTruthy();
  });

  it("pins the latest rev onto a bare link", async () => {
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}`,
    );
    await waitFor(() => expect(readSearch(router).rev).toBe(2));
  });

  it("leaves an unknown rev in place, shows latest and the note", async () => {
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?rev=9`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    expect(
      screen.getByText(/that revision link is no longer available/i),
    ).toBeTruthy();
    expect(readSearch(router)).toEqual({ rev: 9 });
  });

  it("selecting a revision writes rev only", async () => {
    const router = await renderRoute(
      meta({ revisions }),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?rev=2`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    fireEvent.click(screen.getByLabelText("Previous revision, 1"));
    await waitFor(() => expect(readSearch(router).rev).toBe(1));
    expect(readSearch(router).head).toBeUndefined();
    expect(readSearch(router).base).toBeUndefined();
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
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?rev=2&view=full&compare=previous-brief#src/a.ts:R3`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("radio", { name: /^off$/i }));
    await waitFor(() =>
      expect(readSearch(router)).toEqual({ rev: 2, compare: "off" }),
    );
    expect(router.state.location.hash).toBe("src/a.ts:R3");
  });
});
