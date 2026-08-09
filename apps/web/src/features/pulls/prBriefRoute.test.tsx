// @vitest-environment jsdom
// Flat at the feature root with reason: the subject is src/routes' file-based
// route, where a .test file could trip route generation, so it is exercised
// from the owning feature instead. DB-brief route states through the real
// router: a seeded cache renders the brief via BriefView with EMPTY local
// artifacts (the DB path's shape), and meta-only states render the
// wait/failed cards.
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

import { briefFixture } from "@web/features/brief/utils/fixtures";
import { routeTree } from "../../routeTree.gen";
import {
  dbBriefQueryOptions,
  dbComparisonMarksQueryOptions,
  dbDeltaQueryOptions,
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
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
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
    dbComparisonMarksQueryOptions(
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
    // from the pr row (meta.state = open) — never gated on the artifact's
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
    // The phase is "generating" — the heading must NOT echo the verb
    // ("Generating the brief — generating…"); it collapses to the phase-less
    // heading, with a lowercase "brief" for this view.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Generating the brief…" }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("heading", { name: /— generating/i })).toBeNull();
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
    // Disabled options stay focusable (`aria-disabled`) with the reason in a
    // keyboard-reachable tooltip referenced by aria-describedby.
    const button = screen.getByRole("button", { name: /^previous brief$/i });
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
    const button = screen.getByRole("button", { name: /^previous brief$/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    void queryClient;
  });

  it("Compare last-review is offered on the marks-only tier and Changes Only degrades honestly", async () => {
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
      prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
      withLastReview,
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
      dbComparisonMarksQueryOptions(
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
      screen.getByRole("button", { name: /^your last review$/i }),
    );
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    // Marks-only tier: the changes pane degrades — no delta core to render.
    await waitFor(() =>
      expect(screen.getByText(/changes summary unavailable/i)).toBeTruthy(),
    );
  });

  it("Compare last-review renders the pre-warmed delta core when deltaAvailable", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
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
      dbBriefQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
      briefFixture,
    );
    queryClient.setQueryData(
      prDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
      "",
    );
    queryClient.setQueryData(
      dbComparisonMarksQueryOptions(
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
      dbDeltaQueryOptions(REPO_ID, PR_NUMBER, "cp-1", SPAN.head).queryKey,
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

  it("Compare Off is offered in Full Brief so a defaulted comparison can be turned off (codex PR-46 finding)", async () => {
    // A returning reviewer defaults into changes+last-review; after clicking
    // Full Brief the compare stays active — Off must exist to reach full+off.
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}&view=full&compare=off`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    const off = screen.getByRole("button", { name: /^off$/i });
    expect((off as HTMLButtonElement).disabled).toBe(false);
    expect(off.getAttribute("aria-pressed")).toBe("true");
  });

  it("Compare last-review is disabled with the honest reason tooltip per unavailable tier", async () => {
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
      const button = screen.getByRole("button", {
        name: /^your last review$/i,
      });
      expect(button.getAttribute("aria-disabled")).toBe("true");
      const tooltip = document.getElementById(
        button.getAttribute("aria-describedby") ?? "",
      );
      expect(tooltip?.textContent).toMatch(copy);
    }
  });

  it("Compare last-review keeps the generic never-submitted copy when the field is absent", async () => {
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    const button = screen.getByRole("button", { name: /^your last review$/i });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const tooltip = document.getElementById(
      button.getAttribute("aria-describedby") ?? "",
    );
    expect(tooltip?.textContent).toMatch(/no submitted review checkpoint yet/i);
  });

  it("Summary preview opens the in-page drawer (the standalone route can't resolve db: ids)", async () => {
    await renderRoute(
      meta({}),
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?base=${SPAN.base}&head=${SPAN.head}`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    // Lives in the header's More-actions menu.
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    // A BUTTON, not the local cross-route link.
    const trigger = screen.getByRole("menuitem", {
      name: /^summary preview$/i,
    });
    expect(trigger.getAttribute("href")).toBeNull();
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /close summary preview/i }),
      ).toBeTruthy(),
    );
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
    // The legacy (no-revisions) path carries the stale-submit ack too — the
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

  it("own-draft on a HISTORICAL span: the state label stays, mark-ready and its gate do not", async () => {
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
    // The PR is still the viewer's draft — the state label follows STATE,
    // not the revision on screen.
    expect(screen.getByText("Self-review — your draft")).toBeTruthy();
    // But mark-ready is head-scoped: the gate would list THIS revision's
    // flags, not the current head's — so the action reads disabled (still
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
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
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

describe("DB brief route — explicit-span deep link while generating", () => {
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
      error: null,
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
  });

  it("renders the diff-first wait state (NOT the not-found component) when the explicit-span brief 404s while generating", async () => {
    await renderRouteWithFetch(
      (client) => {
        // Meta is seeded (present): the loader resolves it from cache and only
        // the still-generating brief hits the network → 404.
        client.setQueryData(
          prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
          generatingMeta,
        );
        client.setQueryData(
          prDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
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

  it("leaves NO brief query entry in the cache after swallowing the generating-brief 404", async () => {
    const { queryClient } = await renderRouteWithFetch(
      (client) => {
        client.setQueryData(
          prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
          generatingMeta,
        );
        client.setQueryData(
          prDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
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
        dbBriefQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
      ),
    ).toBeUndefined();
  });

  it("flips wait→render without the cached 404 crashing the Brief (artifact lands + meta flips)", async () => {
    let briefReady = false;
    const { queryClient } = await renderRouteWithFetch(
      (client) => {
        client.setQueryData(
          prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
          generatingMeta,
        );
        client.setQueryData(
          prDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
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
      prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
      meta({}),
    );

    // The Brief renders from a FRESH fetch — the evicted 404 does not resurface
    // as the error boundary.
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    expect(screen.queryByText(/brief failed to load/i)).toBeNull();
  });

  it("still renders the not-found component when the PR meta 404s (a missing PR is a real 404)", async () => {
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
