// @vitest-environment jsdom
import type { LocalBriefSummary } from "contract";
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
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
  buildLocalBriefsQueryOptions,
  buildLocalComparisonMarksQueryOptions,
} from "../features/brief/queries";
import { buildViewerQueryOptions } from "../features/account/queries";
import { ViewerStates, type ViewerState } from "../features/account/types";
import type {
  Brief,
  BriefChunk,
  ComparisonMarks,
} from "../features/brief/model";
import { routeTree } from "../routeTree.gen";
import { listRevisionRows, openRevisionsTab } from "../test/revisions";

const SIGNED_IN_VIEWER: ViewerState = {
  kind: ViewerStates.SIGNED_IN,
  login: "octocat",
  avatarUrl: "https://avatars.example/octocat.png",
};

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
  role: "core",
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

const DELTA_PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,1 +10,2 @@",
  " const a = 1;",
  "+guardFromDelta(a);",
].join("\n");

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
      role: "core",
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
      role: "core",
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
  queryClient.setQueryData(
    buildViewerQueryOptions().queryKey,
    SIGNED_IN_VIEWER,
  );
  queryClient.setQueryData(
    buildLocalBriefsQueryOptions().queryKey,
    ALL_ARTIFACTS,
  );
  queryClient.setQueryData(
    buildLocalBriefQueryOptions(headSummary.id).queryKey,
    headBrief,
  );
  queryClient.setQueryData(
    buildLocalBriefQueryOptions(deltaSummary.id).queryKey,
    deltaBrief,
  );
  queryClient.setQueryData(
    buildLocalBriefQueryOptions(lonelySummary.id).queryKey,
    lonelyBrief,
  );
  for (const summary of ALL_ARTIFACTS) {
    queryClient.setQueryData(
      buildLocalBriefDiffsQueryOptions(summary.id).queryKey,
      summary.id === deltaSummary.id
        ? [{ file: "src/a.ts", patch: DELTA_PATCH }]
        : [],
    );
  }
  queryClient.setQueryData(
    buildLocalComparisonMarksQueryOptions("marks-prev-brief-2").queryKey,
    marksPrevious,
  );
  queryClient.setQueryData(
    buildLocalComparisonMarksQueryOptions("marks-chk-brief-2").queryKey,
    marksCheckpoint,
  );
  return queryClient;
}

async function renderAt(
  initialPath: string,
  prepare?: (queryClient: QueryClient) => Promise<void>,
) {
  const queryClient = buildQueryClient();
  await prepare?.(queryClient);
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
 * Characterization coverage for the full View/Compare state matrix:
 * route-level behavior through the actual routed screen, not store internals.
 */
describe("comparison state matrix characterization", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("a Revisions pick keeps View and Compare and drops the line link", async () => {
    const { router } = await renderAt(
      "/briefs/head-brief-2?view=full&compare=off&l=c1",
      async (queryClient) => {
        queryClient.setQueryData(
          buildLocalBriefQueryOptions(prevSummary.id).queryKey,
          headBrief,
        );
      },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: PR.title }),
      ).toBeTruthy(),
    );
    // The same region must stay mounted across the pick: a remounted one
    // starts with its text and announces nothing.
    const status = screen.getByText("Viewing brief 2 of 2.");
    await openRevisionsTab();
    fireEvent.click(listRevisionRows()[0]!);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/briefs/prev-brief-1"),
    );
    expect(router.state.location.search).toEqual({
      view: "full",
      compare: "off",
    });
    await waitFor(() =>
      expect(status.textContent).toBe("Viewing brief 1 of 2."),
    );
    expect(status.isConnected).toBe(true);
  });

  it("a chunk link in Changes exits to Full and keeps Compare and diff", async () => {
    const { router } = await renderAt(
      "/briefs/head-brief-2?view=changes&compare=last-review&diff=split&l=chunk-head-a",
    );

    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        view: "full",
        compare: "last-review",
        diff: "split",
        l: "chunk-head-a",
      }),
    );
    expect(router.history.length).toBe(1);
  });

  it("renders the full Brief unchanged at compare=off when one is available", async () => {
    await renderAt("/briefs/head-brief-2?view=full&compare=off");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: PR.title }),
      ).toBeTruthy(),
    );

    expect(screen.getByText("Tighten validation")).toBeTruthy();
    expect(screen.queryByText(/Changes only ·/)).toBeNull();
    const offButton = screen.getByRole("radio", { name: "Off" });
    expect((offButton as HTMLInputElement).checked).toBe(true);
  });

  it("offers Previous Brief on a later Brief and overlays it on selection", async () => {
    await renderAt("/briefs/head-brief-2?view=full&compare=off");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: PR.title }),
      ).toBeTruthy(),
    );

    const previousBriefButton = screen.getByRole("radio", {
      name: "Previous brief",
    });
    expect(previousBriefButton.getAttribute("aria-disabled")).toBeNull();
    expect((previousBriefButton as HTMLInputElement).checked).toBe(false);

    fireEvent.click(previousBriefButton);

    await waitFor(() =>
      expect((previousBriefButton as HTMLInputElement).checked).toBe(true),
    );
    expect(screen.getByText(/1 change/)).toBeTruthy();
  });

  it("offers Your last review as a compare option when a local Delta exists", async () => {
    await renderAt("/briefs/head-brief-2?view=full&compare=off");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: PR.title }),
      ).toBeTruthy(),
    );

    const lastReviewButton = screen.getByRole("radio", {
      name: "Your last review",
    });
    expect(lastReviewButton.getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(lastReviewButton);

    await waitFor(() =>
      expect((lastReviewButton as HTMLInputElement).checked).toBe(true),
    );
  });

  it("slices the local Delta's rows from its own diffs sidecar", async () => {
    await renderAt("/briefs/head-brief-2?view=changes&compare=last-review");

    await waitFor(() =>
      expect(document.body.textContent).toContain("guardFromDelta(a);"),
    );
  });

  it("cannot select Changes Only without an available comparison", async () => {
    await renderAt("/briefs/lonely-brief-1");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: lonelyBrief.pr.title }),
      ).toBeTruthy(),
    );

    // No comparison is available for this Brief, so both Compare options are
    // unavailable (focusable, with a reason), and Full Brief is the only
    // View with product meaning.
    expect(
      screen
        .getByRole("radio", { name: "Previous brief" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: "Your last review" })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Changes only" }));

    // Changes+off has no product meaning and there's nothing to fall back to,
    // normalization keeps the page on Full Brief.
    expect(screen.getByText("Lonely group")).toBeTruthy();
    expect(screen.queryByText(/Changes only ·/)).toBeNull();
    expect(
      (screen.getByRole("radio", { name: "Full brief" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("keyboard-reachable View and Compare controls update the route state", async () => {
    const { router } = await renderAt(
      "/briefs/head-brief-2?view=full&compare=off",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: PR.title }),
      ).toBeTruthy(),
    );

    const viewGroup = screen.getByRole("group", { name: "Scope" });
    const compareGroup = screen.getByRole("group", { name: "Compare" });
    expect(viewGroup).toBeTruthy();
    expect(compareGroup).toBeTruthy();

    const changesButton = screen.getByRole("radio", { name: "Changes only" });
    // Native radios are focusable by default.
    changesButton.focus();
    expect(document.activeElement).toBe(changesButton);

    const previousBriefButton = screen.getByRole("radio", {
      name: "Previous brief",
    });
    fireEvent.click(previousBriefButton);
    await waitFor(() =>
      expect((previousBriefButton as HTMLInputElement).checked).toBe(true),
    );

    fireEvent.click(changesButton);

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        view: "changes",
        compare: "previous-brief",
      }),
    );
  });

  it("shows the delta as unavailable when its diffs sidecar fails", async () => {
    await renderAt(
      "/briefs/head-brief-2?view=changes&compare=last-review",
      async (queryClient) => {
        queryClient.removeQueries({
          queryKey: buildLocalBriefDiffsQueryOptions(deltaSummary.id).queryKey,
        });
        await queryClient
          .fetchQuery({
            ...buildLocalBriefDiffsQueryOptions(deltaSummary.id),
            queryFn: () => Promise.reject(new Error("sidecar unreadable")),
          })
          .catch(() => undefined);
      },
    );

    await waitFor(() =>
      expect(screen.getByText("Changes summary unavailable.")).toBeTruthy(),
    );
  });

  it("redirects an old Delta URL to its head Brief in changes, last-review", async () => {
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
        screen.getByText(/Changes only · since your last review/),
      ).toBeTruthy(),
    );
  });
});
