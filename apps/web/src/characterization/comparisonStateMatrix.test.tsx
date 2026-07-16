// @vitest-environment jsdom
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
import { afterEach, describe, expect, it } from "vitest";

import {
  localBriefQueryOptions,
  localBriefsQueryOptions,
  localComparisonMarksQueryOptions,
  localRevisionChangesQueryOptions,
  localRevisionNarrativeQueryOptions,
} from "../features/brief/queries";
import type {
  Brief,
  BriefChunk,
  ComparisonMarks,
  LocalBriefSummary,
} from "../features/brief/types";
import { routeTree } from "../routeTree.gen";

const PR = {
  repo: "acme/widgets",
  number: 42,
  title: "Tighten the shared validation path",
  url: "https://example.com/pr/42",
  sha: "head1234fullsha",
  description: "",
};

const PREV_SHA = "prev1234fullsha";
const HEAD_SHA = "head1234fullsha";
const CHECKPOINT_SHA = "chk1234fullsha";

const chunkHead: BriefChunk = {
  id: "chunk-head-a",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: "implementation",
  role: "carrier",
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 11, end: 11 }],
  removedRanges: [],
  riskSurface: [],
  summary: "Head chunk.",
  diff: [
    { kind: "hunk", content: "@@ -10,1 +10,2 @@" },
    { kind: "ctx", content: "const a = 1;", oldLine: 10, newLine: 10 },
    { kind: "add", content: "validate(a);", newLine: 11 },
  ],
};

const headBrief: Brief = {
  artifactKind: "brief",
  pr: PR,
  summary: "Head brief summary.",
  index: 2,
  changeGroups: [
    {
      id: "g1",
      title: "Tighten validation",
      summary: "Adds a validation guard.",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [chunkHead],
  concernView: [],
};

const headSummary: LocalBriefSummary = {
  id: "head-brief-2",
  artifactKind: "brief",
  repo: PR.repo,
  number: PR.number,
  title: PR.title,
  sha: HEAD_SHA,
  index: 2,
  comparisons: {
    previousBrief: {
      marksId: "marks-prev-brief-2",
      baselineSha: PREV_SHA,
      baselineIndex: 1,
    },
    lastReview: {
      marksId: "marks-chk-brief-2",
      deltaId: "delta-brief-2",
      baselineSha: CHECKPOINT_SHA,
      baselineIndex: null,
    },
  },
};

const prevSummary: LocalBriefSummary = {
  id: "prev-brief-1",
  artifactKind: "brief",
  repo: PR.repo,
  number: PR.number,
  title: "Earlier brief",
  sha: PREV_SHA,
  index: 1,
};

const deltaSummary: LocalBriefSummary = {
  id: "delta-brief-2",
  artifactKind: "delta",
  repo: PR.repo,
  number: PR.number,
  title: "Delta since checkpoint",
  sha: HEAD_SHA,
  headSha: HEAD_SHA,
  baselineSha: CHECKPOINT_SHA,
};

const deltaBrief: Brief = {
  artifactKind: "delta",
  pr: PR,
  summary: "Delta since your checkpoint.",
  baselineSha: CHECKPOINT_SHA,
  headSha: HEAD_SHA,
  changeGroups: [
    {
      id: "dg1",
      title: "Guarded shared path",
      summary: "Adds validation since you last looked.",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "dchunk-a",
      changeGroupId: "dg1",
      file: "src/a.ts",
      concern: "implementation",
      role: "carrier",
      loc: { added: 1, deleted: 0 },
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [],
      riskSurface: [],
      summary: "Delta chunk: adds the guard.",
      diff: [{ kind: "add", content: "validate(a);", newLine: 11 }],
    },
  ],
  concernView: [],
};

const marksPrevious: ComparisonMarks = {
  baselineSha: PREV_SHA,
  headSha: HEAD_SHA,
  baselineLabel: "previous-brief",
  baselineIndex: 1,
  files: [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [],
    },
  ],
};

const marksCheckpoint: ComparisonMarks = {
  baselineSha: CHECKPOINT_SHA,
  headSha: HEAD_SHA,
  baselineLabel: "checkpoint",
  baselineIndex: null,
  files: [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [],
    },
  ],
};

const LONELY_SHA = "lonely1111fullsha";

const lonelyBrief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/lonely",
    number: 7,
    title: "A first brief with no history",
    url: "https://example.com/pr/7",
    sha: LONELY_SHA,
    description: "",
  },
  summary: "Lonely brief summary.",
  index: 1,
  changeGroups: [
    {
      id: "lg1",
      title: "Lonely group",
      summary: "Only change so far.",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "lonely-chunk-a",
      changeGroupId: "lg1",
      file: "src/lonely.ts",
      concern: "implementation",
      role: "carrier",
      loc: { added: 1, deleted: 0 },
      addedRanges: [{ start: 1, end: 1 }],
      removedRanges: [],
      riskSurface: [],
      summary: "First chunk.",
    },
  ],
  concernView: [],
};

const lonelySummary: LocalBriefSummary = {
  id: "lonely-brief-1",
  artifactKind: "brief",
  repo: lonelyBrief.pr.repo,
  number: lonelyBrief.pr.number,
  title: lonelyBrief.pr.title,
  sha: LONELY_SHA,
  index: 1,
};

const ALL_ARTIFACTS: LocalBriefSummary[] = [
  headSummary,
  prevSummary,
  deltaSummary,
  lonelySummary,
];

function buildQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(localBriefsQueryOptions().queryKey, ALL_ARTIFACTS);
  queryClient.setQueryData(
    localBriefQueryOptions(headSummary.id).queryKey,
    headBrief,
  );
  queryClient.setQueryData(
    localBriefQueryOptions(deltaSummary.id).queryKey,
    deltaBrief,
  );
  queryClient.setQueryData(
    localBriefQueryOptions(lonelySummary.id).queryKey,
    lonelyBrief,
  );
  queryClient.setQueryData(
    localRevisionChangesQueryOptions(headSummary.id).queryKey,
    null,
  );
  queryClient.setQueryData(
    localRevisionChangesQueryOptions(lonelySummary.id).queryKey,
    null,
  );
  queryClient.setQueryData(
    localComparisonMarksQueryOptions("marks-prev-brief-2").queryKey,
    marksPrevious,
  );
  queryClient.setQueryData(
    localComparisonMarksQueryOptions("marks-chk-brief-2").queryKey,
    marksCheckpoint,
  );
  queryClient.setQueryData(
    localRevisionNarrativeQueryOptions("").queryKey,
    null,
  );
  return queryClient;
}

async function renderAt(initialPath: string) {
  const queryClient = buildQueryClient();
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

/**
 * Characterization coverage for the full View/Compare state matrix (ADR 0024
 * plan step 9): route-level behavior through the actual routed screen, not
 * store internals. Complements the pure-logic coverage in compareState.test.ts
 * and the component-level coverage in comparisonRendering.test.tsx.
 */
describe("comparison state matrix characterization", () => {
  afterEach(() => cleanup());

  it("renders the full Brief unchanged with compare=off, even when a comparison is available", async () => {
    await renderAt("/briefs/head-brief-2?view=full&compare=off");
    await waitFor(() => expect(screen.getByText(PR.title)).toBeTruthy());

    expect(screen.getByText("Tighten validation")).toBeTruthy();
    expect(screen.queryByText(/Changes Only ·/)).toBeNull();
    const offButton = screen.getByRole("button", { name: "Off" });
    expect(offButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("offers Previous Brief on a non-first Brief and applies the overlay on selection", async () => {
    await renderAt("/briefs/head-brief-2?view=full&compare=off");
    await waitFor(() => expect(screen.getByText(PR.title)).toBeTruthy());

    const previousBriefButton = screen.getByRole("button", {
      name: "Previous brief",
    });
    expect((previousBriefButton as HTMLButtonElement).disabled).toBe(false);
    expect(previousBriefButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(previousBriefButton);

    await waitFor(() =>
      expect(previousBriefButton.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByText(/1 change/)).toBeTruthy();
  });

  it("offers Your last review as a peer compare option when a local Delta exists", async () => {
    await renderAt("/briefs/head-brief-2?view=full&compare=off");
    await waitFor(() => expect(screen.getByText(PR.title)).toBeTruthy());

    const lastReviewButton = screen.getByRole("button", {
      name: "Your last review",
    });
    expect((lastReviewButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(lastReviewButton);

    await waitFor(() =>
      expect(lastReviewButton.getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("cannot select Changes Only without an available comparison", async () => {
    await renderAt("/briefs/lonely-brief-1");
    await waitFor(() =>
      expect(screen.getByText(lonelyBrief.pr.title)).toBeTruthy(),
    );

    // No comparison is available for this Brief — both Compare options are
    // disabled, and Full Brief is the only View that has product meaning.
    expect(
      (
        screen.getByRole("button", {
          name: "Previous brief",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Your last review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Changes Only" }));

    // Changes+off has no product meaning and there's nothing to fall back to —
    // normalization keeps the page on Full Brief.
    expect(screen.getByText("Lonely group")).toBeTruthy();
    expect(screen.queryByText(/Changes Only ·/)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Full brief" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("has keyboard-reachable, labelled segmented View/Compare controls that update route state", async () => {
    const { router } = await renderAt(
      "/briefs/head-brief-2?view=full&compare=off",
    );
    await waitFor(() => expect(screen.getByText(PR.title)).toBeTruthy());

    const viewGroup = screen.getByRole("group", { name: "View" });
    const compareGroup = screen.getByRole("group", { name: "Compare" });
    expect(viewGroup).toBeTruthy();
    expect(compareGroup).toBeTruthy();

    const changesButton = screen.getByRole("button", { name: "Changes Only" });
    // Real buttons are focusable/activatable by keyboard by default.
    changesButton.focus();
    expect(document.activeElement).toBe(changesButton);

    const previousBriefButton = screen.getByRole("button", {
      name: "Previous brief",
    });
    fireEvent.click(previousBriefButton);
    await waitFor(() =>
      expect(previousBriefButton.getAttribute("aria-pressed")).toBe("true"),
    );

    fireEvent.click(changesButton);

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        view: "changes",
        compare: "previous-brief",
      }),
    );
  });

  it("redirects an old Delta artifact URL to the head Brief with view=changes&compare=last-review", async () => {
    const { router } = await renderAt("/briefs/delta-brief-2");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/briefs/head-brief-2"),
    );
    expect(router.state.location.search).toMatchObject({
      view: "changes",
      compare: "last-review",
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Changes Only · since your last review/),
      ).toBeTruthy(),
    );
  });
});
