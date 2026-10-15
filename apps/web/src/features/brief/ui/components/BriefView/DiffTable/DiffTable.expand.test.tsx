// @vitest-environment jsdom
import { appI18n } from "../../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createReviewFlowStore,
  emptySessionPayload,
  ReviewSessionProvider,
  ReviewFlowProvider,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import {
  DIFF_ORIGIN_SELECTOR,
  EXPANDED_ORIGIN_SELECTOR,
  EXPANDED_RIGHT_NUMBER_SELECTOR,
  EXPANDED_ROW_SELECTOR,
} from "@web/components/DiffRows/consts";
import type { DiffView } from "@web/components/DiffRows/types";
import type { DiffLine } from "@web/utils/diffTokens/types";
import {
  buildFileRangeQueryKey,
  type FileRangeResult,
} from "../../../../queries";
import { useExpandedRows } from "../../../../model/expansion/useExpandedRows";
import {
  createExpansionStore,
  ExpansionProvider,
} from "../../../../model/expansion/useExpansion";
import {
  ExpansionSourceProvider,
  type ExpansionSource,
} from "../../../../model/expansion/useExpansionSource";
import { FileRowsProvider } from "../../../../model/file-rows/useFileRows";
import type { FileRowsCache } from "../../../../model/file-rows/cache";
import type {
  FileLineOwners,
  LineTarget,
} from "../../../../model/utils/line-owner";
import type {
  ChunkComparisonView,
  ComparisonRun,
} from "../../../../model/comparison/runs";
import type { DigestThreadRow } from "@web/features/conversation/utils";
import { UnknownValues } from "@web/utils/open-enum/types";
import type { Brief, BriefChunk } from "../../../../model/types";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { DiffTable } from ".";
import { ReviewPostureProvider } from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";

const HEAD = "a".repeat(40);
const SOURCE: ExpansionSource = { repoId: "repo-1", prNumber: 7, ref: HEAD };

// Old numbers run three ahead of new, so a wrong offset shows in the gutter.
function stubChunk(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 1 },
    addedRanges: [{ start: 31, end: 31 }],
    removedRanges: [{ start: 34, end: 34 }],
    riskSurface: [],
    diff: [
      { kind: "hunk", content: "@@ -33,3 +30,3 @@" },
      { kind: "ctx", content: "a", oldLine: 33, newLine: 30 },
      { kind: "del", content: "b", oldLine: 34 },
      { kind: "add", content: "c", newLine: 31 },
      { kind: "ctx", content: "d", oldLine: 35, newLine: 32 },
    ],
  } as BriefChunk;
}

/** A chunk whose only gap above is short enough to close in one click. */
function stubShortChunk(): BriefChunk {
  return {
    ...stubChunk(),
    diff: [
      { kind: "hunk", content: "@@ -8,3 +5,3 @@" },
      { kind: "ctx", content: "a", oldLine: 8, newLine: 5 },
      { kind: "del", content: "b", oldLine: 9 },
      { kind: "add", content: "c", newLine: 6 },
      { kind: "ctx", content: "d", oldLine: 10, newLine: 7 },
    ],
  } as BriefChunk;
}

/** One hunk sliced around another chunk's rows: a gap with no header. */
function stubInnerGapChunk(): BriefChunk {
  return {
    ...stubChunk(),
    addedRanges: [
      { start: 2, end: 2 },
      { start: 51, end: 51 },
    ],
    removedRanges: [],
    diff: [
      { kind: "hunk", content: "@@ -1,200 +1,203 @@" },
      { kind: "ctx", content: "a", oldLine: 1, newLine: 1 },
      { kind: "add", content: "b", newLine: 2 },
      { kind: "ctx", content: "c", oldLine: 2, newLine: 3 },
      { kind: "ctx", content: "d", oldLine: 46, newLine: 50 },
      { kind: "add", content: "e", newLine: 51 },
    ],
  } as BriefChunk;
}

function stubNewFileChunk(): BriefChunk {
  return {
    ...stubChunk(),
    loc: { added: 3, deleted: 0 },
    addedRanges: [{ start: 1, end: 3 }],
    removedRanges: [],
    diff: [
      { kind: "hunk", content: "@@ -0,0 +1,3 @@" },
      { kind: "add", content: "a", newLine: 1 },
      { kind: "add", content: "b", newLine: 2 },
      { kind: "add", content: "c", newLine: 3 },
    ],
  } as BriefChunk;
}

function stubDeletedFileChunk(): BriefChunk {
  return {
    ...stubChunk(),
    loc: { added: 0, deleted: 2 },
    addedRanges: [],
    removedRanges: [{ start: 1, end: 2 }],
    diff: [
      { kind: "hunk", content: "@@ -1,2 +0,0 @@" },
      { kind: "del", content: "a", oldLine: 1 },
      { kind: "del", content: "b", oldLine: 2 },
    ],
  } as BriefChunk;
}

/** A new file sliced with a gap: additions on both sides of it. */
function stubNewFileGapChunk(): BriefChunk {
  return {
    ...stubChunk(),
    loc: { added: 4, deleted: 0 },
    addedRanges: [
      { start: 1, end: 2 },
      { start: 51, end: 52 },
    ],
    removedRanges: [],
    diff: [
      { kind: "hunk", content: "@@ -0,0 +1,60 @@" },
      { kind: "add", content: "a", newLine: 1 },
      { kind: "add", content: "b", newLine: 2 },
      { kind: "add", content: "c", newLine: 51 },
      { kind: "add", content: "d", newLine: 52 },
    ],
  } as BriefChunk;
}

function stubBrief(chunk: BriefChunk, sibling?: BriefChunk): Brief {
  const { diff: _rows, ...stored } = chunk;
  const chunks = [stored];
  if (sibling !== undefined) {
    const { diff: _siblingRows, ...storedSibling } = sibling;
    chunks.push(storedSibling);
  }
  return {
    artifactKind: "brief",
    pr: {
      repo: "acme/widgets",
      number: 7,
      title: "t",
      url: "https://example.com/pr/7",
      sha: HEAD,
      description: "",
    },
    summary: "s",
    changeGroups: [
      {
        id: "g1",
        title: "g",
        summary: "g",
        dominantCategory: "bugfix",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
      {
        id: "g2",
        title: "Fix the leak",
        summary: "g",
        dominantCategory: "bugfix",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks,
    concernView: [],
  };
}

function seedRange(
  queryClient: QueryClient,
  from: number,
  to: number,
  totalLines: number,
  result?: FileRangeResult,
): void {
  const key = buildFileRangeQueryKey({
    repoId: SOURCE.repoId,
    prNumber: SOURCE.prNumber,
    ref: HEAD,
    path: "src/a.ts",
    from,
    to,
  });
  const lines: string[] = [];
  for (let line = from; line <= to; line += 1) {
    lines.push(`L${line}`);
  }
  const ready: FileRangeResult = {
    kind: "ready",
    range: { path: "src/a.ts", ref: HEAD, from, to, lines, totalLines },
  };
  queryClient.setQueryData(key, result ?? ready);
}

interface HarnessProps {
  chunk: BriefChunk;
  view: DiffView;
  lineOwners?: FileLineOwners;
  jumpToLine?: (chunkId: string, target: LineTarget) => void;
  deriveChunkUrl?: (chunkId: string) => string;
  hiddenThreads?: readonly DigestThreadRow[];
  fileThreads?: readonly DigestThreadRow[];
  comparisonView?: ChunkComparisonView;
  /** A second table for this chunk, sharing the stores, renders after the first. */
  sibling?: BriefChunk;
}

const NO_COMPARISON: ChunkComparisonView = {
  marks: new Map(),
  runs: [],
  runByRow: new Map(),
};

function stubHiddenThread(line: number): DigestThreadRow {
  return stubFileThread(line, "RIGHT");
}

function stubFileThread(line: number, side: "LEFT" | "RIGHT"): DigestThreadRow {
  return {
    kind: "thread",
    thread: {
      rootCommentId: 9000 + line,
      path: "src/a.ts",
      line,
      side,
      subjectType: "LINE",
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          commentId: 9000 + line,
          author: { login: "alice", isBot: false },
          body: `thread on ${String(line)}`,
          createdAt: "2026-07-01T10:00:00Z",
          url: "https://example.test/c/1",
        },
      ],
      hasMoreComments: false,
    },
    digestLine: `thread on ${String(line)}`,
    placement: { kind: "unanchored", reason: "line-outside-chunks" },
    isOwn: false,
  };
}

/** A chunk whose first rows are a deletion pair with no header above. */
function stubHeaderlessChunk(): BriefChunk {
  return {
    ...stubChunk(),
    diff: [
      { kind: "del", content: "b", oldLine: 34 },
      { kind: "del", content: "b2", oldLine: 35 },
      { kind: "add", content: "c", newLine: 31 },
      { kind: "ctx", content: "d", oldLine: 36, newLine: 32 },
    ],
  } as BriefChunk;
}

const COMPOSER = {
  post: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
  onPosted: vi.fn(),
};

function Harness({
  chunk,
  view,
  lineOwners,
  jumpToLine,
  deriveChunkUrl,
  hiddenThreads,
  fileThreads,
  comparisonView,
  sibling,
}: HarnessProps) {
  const expansion = useExpandedRows({
    chunkId: chunk.id,
    path: chunk.file,
    rows: chunk.diff ?? [],
  });
  return (
    <>
      <div data-testid={`table-${chunk.id}`}>
        <DiffTable
          addressedComments={[]}
          chunk={chunk}
          comparisonSkipReason={null}
          comparisonSource={{ kind: "last-review", delta: null }}
          comparisonView={comparisonView ?? NO_COMPARISON}
          conversationComposer={COMPOSER}
          expansion={expansion}
          fileThreads={fileThreads}
          hiddenThreads={hiddenThreads}
          deriveChunkUrl={deriveChunkUrl}
          jumpToLine={jumpToLine}
          lineOwners={lineOwners}
          reviewCommentLabel="review comment"
          view={view}
        />
      </div>
      {sibling === undefined ? null : (
        <div data-testid={`table-${sibling.id}`}>
          <DiffTable
            addressedComments={[]}
            chunk={sibling}
            comparisonSkipReason={null}
            comparisonSource={{ kind: "last-review", delta: null }}
            comparisonView={NO_COMPARISON}
            conversationComposer={COMPOSER}
            lineOwners={lineOwners}
            reviewCommentLabel="review comment"
            view={view}
          />
        </div>
      )}
    </>
  );
}

function renderHarness(
  props: HarnessProps,
  options: {
    source?: ExpansionSource | undefined;
    session?: ReviewSessionPayload | undefined;
    fileRows?: FileRowsCache | undefined;
  } = {},
) {
  const queryClient = new QueryClient();
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
      reanchorComment: vi.fn(),
    },
    appI18n.t,
  );
  const openCommentComposer = vi.fn(flowStore.getState().actions.openComposer);
  flowStore.setState({
    actions: {
      ...flowStore.getState().actions,
      openComposer: openCommentComposer,
    },
  });
  const expansion = createExpansionStore();
  const source = "source" in options ? options.source : SOURCE;
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ExpansionSourceProvider source={source}>
        <ExpansionProvider store={expansion}>
          <FileRowsProvider cache={options.fileRows}>
            <ReviewSessionProvider
              briefId="test-brief"
              model={buildBriefViewModel(stubBrief(props.chunk, props.sibling))}
              session={options.session}
            >
              <ReviewFlowProvider store={flowStore}>
                <ReviewPostureProvider posture={makeReviewPosture()}>
                  <Harness {...props} />
                </ReviewPostureProvider>
              </ReviewFlowProvider>
            </ReviewSessionProvider>
          </FileRowsProvider>
        </ExpansionProvider>
      </ExpansionSourceProvider>
    </QueryClientProvider>,
  );
  return { view, queryClient, flowStore, expansion, openCommentComposer };
}

function expandedRows(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(EXPANDED_ROW_SELECTOR),
  );
}

function numberCells(row: Element): string[] {
  return Array.from(row.querySelectorAll("[data-line-number]")).map(
    (cell) => cell.textContent ?? "",
  );
}

describe("DiffTable expansion controls", () => {
  it("puts the arrows on the hunk header and a trailing row below", () => {
    const { view } = renderHarness({ chunk: stubChunk(), view: "unified" });

    const header = view.container.querySelector('tr[data-line-kind="hunk"]');
    expect(header?.textContent).toContain("@@ -33,3 +30,3 @@");
    const up = screen.getByRole("button", { name: "Show 20 more lines above" });
    expect(header?.contains(up)).toBe(true);
    const upArrow = up.querySelector('[data-icon="arrow-up"]');
    expect(upArrow?.hasAttribute("data-rotation")).toBe(false);
    const down = screen.getByRole("button", {
      name: "Show 20 more lines below",
    });
    const downArrow = down.querySelector('[data-icon="arrow-up"]');
    expect(downArrow?.getAttribute("data-rotation")).toBe("180");
    expect(
      view.container.querySelector("tbody")?.lastElementChild?.contains(down),
    ).toBe(true);
  });

  it("stays folded with no source to read from", () => {
    renderHarness(
      { chunk: stubChunk(), view: "unified" },
      { source: undefined },
    );

    expect(screen.queryByRole("button", { name: /more lines/ })).toBeNull();
  });

  it("names the whole remainder when twenty or fewer lines are left", () => {
    renderHarness({ chunk: stubShortChunk(), view: "unified" });

    expect(
      screen.getByRole("button", { name: "Show all 4 hidden lines above" }),
    ).toBeTruthy();
  });

  it("counts the shipped threads the gap hides", () => {
    renderHarness({
      chunk: stubChunk(),
      view: "unified",
      hiddenThreads: [12, 20, 45].map(stubHiddenThread),
    });

    expect(
      screen.getByRole("button", { name: "2 comments in the hidden lines" }),
    ).toBeTruthy();
  });

  it("counts and reveals hidden threads through a sibling's lines", async () => {
    const { view, queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
      hiddenThreads: [22, 27].map(stubHiddenThread),
      fileThreads: [22, 27].map(stubHiddenThread),
    });
    expect(
      screen.getByRole("button", { name: "2 comments in the hidden lines" }),
    ).toBeTruthy();
    seedRange(queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(20));
    expect(
      view.container.querySelector('tr[data-conversation-thread="9027"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelector('tr[data-conversation-thread="9022"]'),
    ).not.toBeNull();
  });

  it("routes the chip through the arrow's read and shows its failure", async () => {
    const { queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
      hiddenThreads: [27].map(stubHiddenThread),
    });
    seedRange(queryClient, 10, 29, 80, { kind: "too-large" });
    const chip = screen.getByRole("button", {
      name: "1 comment in the hidden lines",
    });
    fireEvent.click(chip);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "This file is too large to expand.",
      ),
    );
    expect(chip.getAttribute("aria-describedby")).toBe(
      screen.getByRole("status").id,
    );
    expect(
      screen
        .getByRole("button", { name: "Show 20 more lines above" })
        .getAttribute("aria-describedby"),
    ).toBe(screen.getByRole("status").id);
  });

  it("offers the arrow above in split when the chunk opens on a pair", () => {
    renderHarness({ chunk: stubHeaderlessChunk(), view: "split" });

    expect(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    ).toBeTruthy();
  });
});

describe("DiffTable expansion into a sibling hunk", () => {
  const fileRows: DiffLine[] = [
    { kind: "hunk", content: "@@ -13,3 +10,4 @@" },
    { kind: "ctx", content: "keep", oldLine: 13, newLine: 10 },
    { kind: "del", content: "old", oldLine: 14 },
    { kind: "add", content: "n1", newLine: 11 },
    { kind: "add", content: "n2", newLine: 12 },
    { kind: "ctx", content: "keep", oldLine: 15, newLine: 13 },
    ...(stubChunk().diff ?? []),
  ];
  const cache: FileRowsCache = { isEmpty: false, getFileRows: () => fileRows };

  it("shows the hunk's add and del rows without reading the file", async () => {
    const { view, queryClient } = renderHarness(
      { chunk: stubChunk(), view: "unified" },
      { fileRows: cache },
    );
    seedRange(queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(21));
    const kinds = expandedRows(view.container).map((row) =>
      row.getAttribute("data-line-kind"),
    );
    expect(kinds.slice(0, 5)).toEqual(["ctx", "del", "add", "add", "ctx"]);
    expect(numberCells(expandedRows(view.container)[1]!)).toEqual(["14", ""]);
    expect(numberCells(expandedRows(view.container)[5]!)).toEqual(["16", "14"]);
  });

  it("records a covered range without a file-range read", async () => {
    const short = {
      ...stubChunk(),
      diff: [
        { kind: "hunk", content: "@@ -16,3 +13,3 @@" },
        { kind: "ctx", content: "d", oldLine: 16, newLine: 13 },
        { kind: "add", content: "e", newLine: 14 },
        { kind: "ctx", content: "f", oldLine: 17, newLine: 15 },
      ],
    } as BriefChunk;
    const covered: DiffLine[] = [
      { kind: "hunk", content: "@@ -1,15 +1,12 @@" },
      ...Array.from({ length: 12 }, (_unused, index) => ({
        kind: "ctx" as const,
        content: `k${String(index + 1)}`,
        oldLine: index + 1,
        newLine: index + 1,
      })),
      { kind: "del", content: "x", oldLine: 13 },
      { kind: "del", content: "y", oldLine: 14 },
      { kind: "del", content: "z", oldLine: 15 },
      ...(short.diff ?? []),
    ];
    const { view, queryClient, expansion } = renderHarness(
      { chunk: short, view: "unified" },
      { fileRows: { isEmpty: false, getFileRows: () => covered } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show all 12 hidden lines above" }),
    );

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(15));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(expansion.getState().expandedEdges.get("c1:1:up")?.range).toEqual({
      start: 1,
      end: 12,
    });
  });
});

describe("DiffTable sibling spans", () => {
  const sibling: BriefChunk = {
    ...stubChunk(),
    id: "c2",
    changeGroupId: "g2",
    summary: "Adds the guard",
    addedRanges: [{ start: 11, end: 12 }],
    removedRanges: [{ start: 14, end: 14 }],
    diff: [
      { kind: "hunk", content: "@@ -13,3 +10,4 @@" },
      { kind: "ctx", content: "keep", oldLine: 13, newLine: 10 },
      { kind: "del", content: "old", oldLine: 14 },
      { kind: "add", content: "n1", newLine: 11 },
      { kind: "add", content: "n2", newLine: 12 },
      { kind: "ctx", content: "keep", oldLine: 15, newLine: 13 },
    ],
  };
  const remainder: BriefChunk = {
    ...stubChunk(),
    id: "u-1",
    changeGroupId: "unattributed-remainder",
    addedRanges: [{ start: 16, end: 16 }],
    removedRanges: [],
    diff: [
      { kind: "hunk", content: "@@ -17,1 +15,2 @@" },
      { kind: "ctx", content: "keep", oldLine: 17, newLine: 15 },
      { kind: "add", content: "stray", newLine: 16 },
    ],
  };
  const fileRows: DiffLine[] = [
    { kind: "hunk", content: "@@ -13,4 +10,7 @@" },
    { kind: "ctx", content: "keep", oldLine: 13, newLine: 10 },
    { kind: "del", content: "old", oldLine: 14 },
    { kind: "add", content: "n1", newLine: 11 },
    { kind: "add", content: "n2", newLine: 12 },
    { kind: "ctx", content: "keep", oldLine: 15, newLine: 13 },
    { kind: "ctx", content: "keep", oldLine: 16, newLine: 14 },
    { kind: "ctx", content: "keep", oldLine: 17, newLine: 15 },
    { kind: "add", content: "stray", newLine: 16 },
    ...(stubChunk().diff ?? []),
  ];
  const cache: FileRowsCache = { isEmpty: false, getFileRows: () => fileRows };
  const lineOwners: FileLineOwners = {
    chunks: [stubChunk(), sibling, remainder],
    owners: new Map([
      [
        "c2",
        {
          chunkId: "c2",
          groupName: "Fix the leak",
          groupIndex: 2,
          groupCount: 3,
          summary: "Adds the guard",
          remainder: false,
        },
      ],
      [
        "u-1",
        {
          chunkId: "u-1",
          groupName: "Unattributed remainder",
          groupIndex: 3,
          groupCount: 3,
          remainder: true,
        },
      ],
    ]),
  };

  function stubChunkUrl(chunkId: string): string {
    return `/repos/1/pulls/2?rev=1&l=${chunkId}`;
  }

  async function expandIntoSiblings(
    view: DiffView,
    extra: Partial<HarnessProps> = {},
    session?: ReviewSessionPayload,
    rowsCache: FileRowsCache = cache,
  ) {
    const jumpToLine = vi.fn();
    const harness = renderHarness(
      {
        chunk: stubChunk(),
        view,
        lineOwners,
        jumpToLine,
        deriveChunkUrl: stubChunkUrl,
        ...extra,
      },
      { fileRows: rowsCache, session },
    );
    seedRange(harness.queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );
    await waitFor(() =>
      expect(
        harness.view.container.querySelectorAll('[data-testid="sibling-span"]'),
      ).toHaveLength(2),
    );
    return { ...harness, jumpToLine };
  }

  function findSpanRow(container: HTMLElement, line: string): HTMLElement {
    const row = expandedRows(container).find(
      (candidate) => numberCells(candidate)[1] === line,
    );
    if (row === undefined) {
      throw new Error(`no expanded row on ${line}`);
    }
    return row;
  }

  function stubSpanDraft(): ReviewSessionPayload {
    return {
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "51",
          filePath: "src/a.ts",
          kind: "line",
          side: "new",
          startLine: 11,
          endLine: 11,
          body: "span draft",
          status: "draft",
        },
      ],
    };
  }

  it("frames each owner's expanded changed rows under a header naming it", async () => {
    const { view } = await expandIntoSiblings("unified");
    const headers = view.container.querySelectorAll(
      '[data-testid="sibling-span"]',
    );

    expect(headers[0]?.textContent).toContain(
      "Lines 11 to 12 belong to Fix the leak (group 2 of 3)",
    );
    expect(headers[0]?.textContent).toContain("Adds the guard");
    expect(headers[0]?.querySelector("strong")?.textContent).toBe(
      "Fix the leak",
    );
    expect(headers[1]?.textContent).toContain(
      "Line 16 belongs to Unattributed remainder (group 3 of 3)",
    );
    expect(view.container.querySelectorAll("td[data-span]")).toHaveLength(4);
    expect(headers[0]?.nextElementSibling?.getAttribute("data-line-kind")).toBe(
      "del",
    );
  });

  it("keeps the expanded context around a span outside the frame", async () => {
    const { view } = await expandIntoSiblings("unified");
    const rows = expandedRows(view.container);

    expect(rows[0]?.querySelector("td[data-span]")).toBeNull();
    expect(rows[4]?.querySelector("td[data-span]")).toBeNull();
  });

  it("links to the owning chunk and scrolls to it in the app on click", async () => {
    const { jumpToLine } = await expandIntoSiblings("unified");
    const control = screen.getByRole("link", {
      name: "Go to chunk in Fix the leak",
    });
    control.focus();
    const navigated = fireEvent.click(control);

    expect(control.getAttribute("href")).toBe("/repos/1/pulls/2?rev=1&l=c2");
    expect(navigated).toBe(false);
    expect(jumpToLine).toHaveBeenCalledWith("c2", { side: "new", line: 11 });
    expect(
      screen
        .getByRole("link", {
          name: "Go to chunk in the unattributed remainder",
        })
        .getAttribute("href"),
    ).toBe("/repos/1/pulls/2?rev=1&l=u-1");
  });

  it("keeps a modified click a link, not an in-app scroll to target", async () => {
    const { jumpToLine } = await expandIntoSiblings("unified");
    const control = screen.getByRole("link", {
      name: "Go to chunk in Fix the leak",
    });
    const navigated = fireEvent.click(control, { metaKey: true });

    expect(navigated).toBe(true);
    expect(jumpToLine).not.toHaveBeenCalled();
  });

  it("renders no control when nothing can land", async () => {
    const harness = renderHarness(
      { chunk: stubChunk(), view: "unified", lineOwners },
      { fileRows: cache },
    );
    seedRange(harness.queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() =>
      expect(
        harness.view.container.querySelectorAll('[data-testid="sibling-span"]'),
      ).toHaveLength(2),
    );
    expect(screen.queryByRole("link", { name: /Go to chunk/ })).toBeNull();
  });

  it("frames the span in split view without breaking the pairs", async () => {
    const { view } = await expandIntoSiblings("split");
    const header = view.container.querySelector('[data-testid="sibling-span"]');
    const pair = header?.nextElementSibling;

    expect(pair?.querySelectorAll('td[data-line-kind="del"]')).toHaveLength(2);
    expect(pair?.querySelectorAll('td[data-line-kind="add"]')).toHaveLength(2);
    expect(pair?.querySelector("td[data-span]")).not.toBeNull();
  });

  it("offers the arrow past a sibling's lines instead of a dead end", async () => {
    await expandIntoSiblings("unified");

    expect(
      screen.getByRole("button", { name: "Show all 9 hidden lines above" }),
    ).toBeTruthy();
  });

  it("never frames a line the chunk's own ranges hold", async () => {
    const own: BriefChunk = {
      ...stubChunk(),
      addedRanges: [
        { start: 31, end: 31 },
        { start: 16, end: 16 },
      ],
    };
    const jumpToLine = vi.fn();
    const harness = renderHarness(
      {
        chunk: own,
        view: "unified",
        lineOwners: { ...lineOwners, chunks: [own, sibling, remainder] },
        jumpToLine,
      },
      { fileRows: cache },
    );
    seedRange(harness.queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() =>
      expect(expandedRows(harness.view.container)).toHaveLength(21),
    );
    expect(
      harness.view.container.querySelectorAll('[data-testid="sibling-span"]'),
    ).toHaveLength(1);
    expect(jumpToLine).not.toHaveBeenCalled();
  });

  it("unzips a split pair whose sides belong to different owners", async () => {
    const replaced: DiffLine[] = [
      { kind: "hunk", content: "@@ -13,4 +10,4 @@" },
      { kind: "ctx", content: "keep", oldLine: 13, newLine: 10 },
      { kind: "del", content: "x1", oldLine: 14 },
      { kind: "del", content: "x2", oldLine: 15 },
      { kind: "add", content: "y1", newLine: 11 },
      { kind: "add", content: "y2", newLine: 12 },
      { kind: "ctx", content: "keep", oldLine: 16, newLine: 13 },
      ...(stubChunk().diff ?? []),
    ];
    const deleter: BriefChunk = {
      ...sibling,
      id: "c2",
      addedRanges: [],
      removedRanges: [{ start: 14, end: 15 }],
    };
    const adder: BriefChunk = {
      ...sibling,
      id: "c3",
      changeGroupId: "g3",
      addedRanges: [{ start: 11, end: 12 }],
      removedRanges: [],
    };
    const owners: FileLineOwners = {
      chunks: [stubChunk(), deleter, adder],
      owners: new Map([
        [
          "c2",
          {
            chunkId: "c2",
            groupName: "Fix the leak",
            groupIndex: 2,
            groupCount: 3,
            remainder: false,
          },
        ],
        [
          "c3",
          {
            chunkId: "c3",
            groupName: "Add the guard",
            groupIndex: 3,
            groupCount: 3,
            remainder: false,
          },
        ],
      ]),
    };
    const harness = renderHarness(
      { chunk: stubChunk(), view: "split", lineOwners: owners },
      { fileRows: { isEmpty: false, getFileRows: () => replaced } },
    );
    seedRange(harness.queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() =>
      expect(
        harness.view.container.querySelectorAll(
          'td[data-side="left"][data-line-kind="del"][data-line-number]',
        ),
      ).toHaveLength(3),
    );
    const headers = harness.view.container.querySelectorAll(
      '[data-testid="sibling-span"]',
    );
    expect(
      [...headers].map(
        (header) =>
          header.querySelector('[data-testid="sibling-span-label"]')
            ?.textContent,
      ),
    ).toEqual([
      "Removed lines 14 to 15 belong to Fix the leak (group 2 of 3)",
      "Lines 11 to 12 belong to Add the guard (group 3 of 3)",
    ]);
    for (const row of harness.view.container.querySelectorAll("tr")) {
      if (row.querySelector(`td${EXPANDED_ORIGIN_SELECTOR}`) === null) {
        continue;
      }
      const del = row.querySelector(
        'td[data-side="left"][data-line-kind="del"]',
      );
      const add = row.querySelector(
        'td[data-side="right"][data-line-kind="add"]',
      );
      expect(del === null || add === null).toBe(true);
    }
    expect(
      harness.view.container.querySelectorAll("td[data-span]"),
    ).toHaveLength(4);
  });

  it("opens the composer on a span row under the owner's chunk id", async () => {
    const { view, openCommentComposer } = await expandIntoSiblings("unified");
    const row = findSpanRow(view.container, "11");
    const sign = row.querySelector("[data-comment-anchor]")!;
    fireEvent.mouseDown(sign);
    fireEvent.mouseUp(sign);

    expect(row.getAttribute("aria-disabled")).toBeNull();
    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      chunkId: "c2",
      file: "src/a.ts",
      side: "new",
      startLine: 11,
      endLine: 11,
      rowIds: ["c2:3"],
    });
    expect(openCommentComposer.mock.calls[0]?.[2]).toBe("c1");
    expect(row.nextElementSibling?.querySelector("textarea")).not.toBeNull();
  });

  it("keeps a composer row inside a span in the frame", async () => {
    const { view } = await expandIntoSiblings("unified");
    const row = findSpanRow(view.container, "11");
    const sign = row.querySelector("[data-comment-anchor]")!;
    fireEvent.mouseDown(sign);
    fireEvent.mouseUp(sign);

    const composerRow = row.nextElementSibling!;
    expect(composerRow.querySelector("textarea")).not.toBeNull();
    expect(composerRow.hasAttribute("data-span")).toBe(true);
  });

  it("anchors a deletion picked inside a span on the old side", async () => {
    const { view, openCommentComposer } = await expandIntoSiblings("unified");
    const row = expandedRows(view.container).find(
      (candidate) => numberCells(candidate)[0] === "14",
    )!;
    fireEvent.keyDown(row, { key: "Enter" });

    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      chunkId: "c2",
      side: "old",
      startLine: 14,
      endLine: 14,
      rowIds: ["c2:2"],
    });
  });

  it("refuses a range that leaves the span", async () => {
    const { view, openCommentComposer } = await expandIntoSiblings("unified");
    const inSpan = findSpanRow(view.container, "12").querySelector(
      "[data-comment-anchor]",
    )!;
    const outside = findSpanRow(view.container, "13").querySelector(
      "[data-comment-anchor]",
    )!;
    fireEvent.mouseDown(inSpan);
    fireEvent.mouseEnter(outside);
    fireEvent.mouseUp(outside);
    const stray = findSpanRow(view.container, "16").querySelector(
      "[data-comment-anchor]",
    )!;
    fireEvent.mouseDown(inSpan);
    fireEvent.mouseEnter(stray);
    fireEvent.mouseUp(stray);

    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("lets a range cross the context the owner's own diff carries", async () => {
    const interleaved: BriefChunk = {
      ...sibling,
      addedRanges: [
        { start: 11, end: 11 },
        { start: 13, end: 13 },
      ],
      removedRanges: [],
      diff: [
        { kind: "hunk", content: "@@ -13,3 +10,5 @@" },
        { kind: "ctx", content: "keep", oldLine: 13, newLine: 10 },
        { kind: "add", content: "n1", newLine: 11 },
        { kind: "ctx", content: "mid", oldLine: 14, newLine: 12 },
        { kind: "add", content: "n3", newLine: 13 },
        { kind: "ctx", content: "keep", oldLine: 15, newLine: 14 },
      ],
    };
    const rows: DiffLine[] = [
      ...(interleaved.diff ?? []),
      { kind: "ctx", content: "keep", oldLine: 16, newLine: 15 },
      { kind: "add", content: "stray", newLine: 16 },
      ...(stubChunk().diff ?? []),
    ];
    const { view, openCommentComposer } = await expandIntoSiblings(
      "unified",
      {
        lineOwners: {
          ...lineOwners,
          chunks: [stubChunk(), interleaved, remainder],
        },
      },
      undefined,
      { isEmpty: false, getFileRows: () => rows },
    );
    const middle = findSpanRow(view.container, "12");
    const first = findSpanRow(view.container, "11").querySelector(
      "[data-comment-anchor]",
    )!;
    const last = findSpanRow(view.container, "13").querySelector(
      "[data-comment-anchor]",
    )!;
    fireEvent.mouseDown(first);
    fireEvent.mouseEnter(last);
    fireEvent.mouseUp(last);

    expect(middle.getAttribute("aria-disabled")).toBeNull();
    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      chunkId: "c2",
      side: "new",
      startLine: 11,
      endLine: 13,
      rowIds: ["c2:2", "c2:3", "c2:4"],
    });
  });

  it("keeps an expanded context row uncommentable", async () => {
    const { view } = await expandIntoSiblings("unified");
    const row = findSpanRow(view.container, "13");

    expect(row.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(
      row.getAttribute("aria-describedby") ?? "",
    );
    expect(reason?.textContent).toBe(
      "Outside this chunk's diff; comments need one of its lines or a sibling span's.",
    );
  });

  it("shows the owner's draft in the span and in the owner card", async () => {
    const { view } = await expandIntoSiblings(
      "unified",
      { sibling },
      stubSpanDraft(),
    );
    const drafts = screen.getAllByText("span draft");

    expect(drafts).toHaveLength(2);
    const inSpan = drafts.find((draft) =>
      draft.closest('[data-testid="table-c1"]'),
    )!;
    expect(
      numberCells(inSpan.closest("tr")?.previousElementSibling ?? inSpan),
    ).toEqual(["", "11"]);
    expect(
      view.container.querySelector(
        '[data-testid="table-c2"] tr[data-line-kind="add"]',
      )?.nextElementSibling?.textContent,
    ).toContain("span draft");
  });

  it("renders a sibling's thread under the span row that shows its line", async () => {
    const { view } = await expandIntoSiblings("unified", {
      fileThreads: [stubFileThread(11, "RIGHT"), stubFileThread(14, "LEFT")],
    });
    const right = view.container.querySelector(
      'tr[data-conversation-thread="9011"]',
    );
    const left = view.container.querySelector(
      'tr[data-conversation-thread="9014"]',
    );

    expect(numberCells(right?.previousElementSibling ?? right!)).toEqual([
      "",
      "11",
    ]);
    expect(numberCells(left?.previousElementSibling ?? left!)).toEqual([
      "14",
      "",
    ]);
  });

  it("renders a thread with an unknown side on no span row", async () => {
    const known = stubFileThread(11, "RIGHT");
    const unknown: DigestThreadRow = {
      ...known,
      thread: { ...known.thread, side: UnknownValues.UNKNOWN },
    };
    const { view } = await expandIntoSiblings("unified", {
      fileThreads: [unknown],
    });

    expect(
      view.container.querySelector('tr[data-conversation-thread="9011"]'),
    ).toBeNull();
  });

  it("keeps revision marks off the span rows", async () => {
    const run: ComparisonRun = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [2, 3],
      kind: "added",
    };
    const { view } = await expandIntoSiblings("unified", {
      comparisonView: {
        marks: new Map([
          [2, "added"],
          [3, "added"],
        ]),
        runs: [run],
        runByRow: new Map([
          [2, run],
          [3, run],
        ]),
      },
    });

    for (const row of expandedRows(view.container)) {
      expect(row.getAttribute("data-rev")).toBeNull();
    }
    expect(
      view.container
        .querySelector(`tr[data-line-kind="add"]${DIFF_ORIGIN_SELECTOR}`)
        ?.getAttribute("data-rev"),
    ).toBe("added");
  });
});

describe("DiffTable expansion click", () => {
  it("splices twenty lines above with old numbers from the hunk offset", async () => {
    const { view, queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
    });
    seedRange(queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(20));
    const first = expandedRows(view.container)[0]!;
    expect(numberCells(first)).toEqual(["13", "10"]);
    expect(first.textContent).toContain("L10");
    const header = view.container.querySelector('tr[data-line-kind="hunk"]');
    expect(first.previousElementSibling).toBe(header);
    expect(
      screen.getByRole("button", { name: "Show all 9 hidden lines above" }),
    ).toBeTruthy();
  });

  it("drops the header and focuses the first new line when the gap closes", async () => {
    const { view, queryClient, flowStore } = renderHarness({
      chunk: stubShortChunk(),
      view: "unified",
    });
    seedRange(queryClient, 1, 4, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show all 4 hidden lines above" }),
    );

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(4));
    expect(
      view.container.querySelector('tr[data-line-kind="hunk"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(expandedRows(view.container)[0]);
    await waitFor(() =>
      expect(flowStore.getState().toast).toBe("4 lines shown"),
    );
  });

  it("keeps the control's row where it was when rows land above it", async () => {
    const { view, queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
    });
    seedRange(queryClient, 33, 52, 80);
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    // The click measures once; the landing measures once more.
    const tops = [100, 540];
    const rect = vi
      .spyOn(HTMLTableRowElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ top: tops.shift() ?? 540 }) as DOMRect);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines below" }),
    );

    // The landing is registered before the read: the commit that inserts
    // the rows is the one that corrects the scroll.
    await waitFor(() => {
      expect(expandedRows(view.container)).toHaveLength(20);
      expect(scrollBy).toHaveBeenCalledWith({ top: 440, behavior: "instant" });
    });
    rect.mockRestore();
    scrollBy.mockRestore();
  });

  it("focuses the first new line when a spent arrow leaves its header", async () => {
    const { view, queryClient } = renderHarness({
      chunk: stubShortChunk(),
      view: "unified",
    });
    seedRange(queryClient, 1, 4, 80);
    const arrow = screen.getByRole("button", {
      name: "Show all 4 hidden lines above",
    });
    arrow.focus();
    fireEvent.click(arrow);

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(4));
    expect(screen.queryByRole("button", { name: /lines above/ })).toBeNull();
    expect(document.activeElement).toBe(expandedRows(view.container)[0]);
  });

  it("reads once when the arrow is activated twice before rows land", async () => {
    const { view, queryClient, expansion } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
    });
    seedRange(queryClient, 33, 52, 80);
    const arrow = screen.getByRole("button", {
      name: "Show 20 more lines below",
    });
    fireEvent.click(arrow);
    fireEvent.click(arrow);

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(20));
    const edges = [...expansion.getState().expandedEdges.values()];
    expect(edges.map((edge) => edge.range)).toEqual([{ start: 33, end: 52 }]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a headerless gap's control in place in split and keys rows once", async () => {
    const gapped = {
      ...stubChunk(),
      diff: [
        { kind: "ctx", content: "a", oldLine: 33, newLine: 30 },
        { kind: "del", content: "b", oldLine: 34 },
        { kind: "add", content: "c", newLine: 31 },
        { kind: "ctx", content: "d", oldLine: 35, newLine: 32 },
        { kind: "ctx", content: "z", oldLine: 60, newLine: 57 },
      ],
    } as BriefChunk;
    const { view, queryClient } = renderHarness({
      chunk: gapped,
      view: "split",
    });
    seedRange(queryClient, 33, 52, 80);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const tops = [100, 540];
    const rect = vi
      .spyOn(HTMLTableRowElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ top: tops.shift() ?? 540 }) as DOMRect);
    const control = screen.getAllByTestId("expand-control")[0]?.closest("tr");
    // The inner gap's arrow comes first; the tail's is the second one.
    fireEvent.click(
      screen.getAllByRole("button", { name: "Show 20 more lines below" })[0]!,
    );

    await waitFor(() =>
      expect(
        view.container.querySelectorAll(EXPANDED_RIGHT_NUMBER_SELECTOR),
      ).toHaveLength(20),
    );
    expect(screen.getAllByTestId("expand-control")[0]?.closest("tr")).toBe(
      control,
    );
    expect(scrollBy).toHaveBeenCalledWith({ top: 440, behavior: "instant" });
    expect(
      errors.mock.calls.some((call) => String(call[0]).includes("same key")),
    ).toBe(false);
    rect.mockRestore();
    scrollBy.mockRestore();
    errors.mockRestore();
  });

  it("shows a curated note when the file cannot be expanded", async () => {
    const { queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
    });
    seedRange(queryClient, 10, 29, 80, { kind: "too-large" });
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "This file is too large to expand.",
      ),
    );
    const arrow = screen.getByRole("button", {
      name: "Show 20 more lines above",
    });
    expect(arrow.getAttribute("aria-disabled")).toBeNull();
    expect(arrow.getAttribute("aria-describedby")).toBe(
      screen.getByRole("status").id,
    );
    const header = screen.getByRole("status").closest("tr");
    expect(header?.getAttribute("data-line-kind")).toBe("hunk");
    expect(
      screen
        .getByRole("button", { name: "Show 20 more lines below" })
        .getAttribute("aria-describedby"),
    ).toBeNull();
  });

  it("shares one note when both arrows of a gap fail the same way", async () => {
    const { queryClient } = renderHarness({
      chunk: stubInnerGapChunk(),
      view: "unified",
    });
    seedRange(queryClient, 4, 23, 80, { kind: "too-large" });
    seedRange(queryClient, 30, 49, 80, { kind: "too-large" });
    const above = () =>
      screen.getByRole("button", { name: "Show 20 more lines above" });
    const below = () =>
      screen.getAllByRole("button", { name: "Show 20 more lines below" })[0];
    fireEvent.click(below()!);
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
    fireEvent.click(above());
    await waitFor(() =>
      expect(above().getAttribute("aria-describedby")).not.toBeNull(),
    );

    const notes = screen.getAllByRole("status");
    expect(notes).toHaveLength(1);
    expect(above().closest("tr")).toBe(below()?.closest("tr"));
    expect(above().getAttribute("aria-describedby")).toBe(notes[0]?.id);
    expect(below()?.getAttribute("aria-describedby")).toBe(notes[0]?.id);
  });

  it("offers no expander on a new file", () => {
    renderHarness({ chunk: stubNewFileChunk(), view: "unified" });

    expect(screen.queryByRole("button", { name: /more lines/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /hidden line/ })).toBeNull();
  });

  it("offers no expander on a deleted file", () => {
    renderHarness({ chunk: stubDeletedFileChunk(), view: "unified" });

    expect(screen.queryByRole("button", { name: /more lines/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /hidden line/ })).toBeNull();
  });

  it("offers no expander for a gap inside a new file", () => {
    renderHarness({ chunk: stubNewFileGapChunk(), view: "unified" });

    expect(screen.queryByRole("button", { name: /more lines/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /hidden line/ })).toBeNull();
  });

  it("retires the trailing arrow once a read has named the file end", async () => {
    const { queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
    });
    seedRange(queryClient, 33, 52, 32);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines below" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Show 20 more lines below" }),
      ).toBeNull(),
    );
  });

  it("retries on the next click and clears the note once lines land", async () => {
    const { view, queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
    });
    seedRange(queryClient, 10, 29, 80, { kind: "not-found" });
    const arrow = () =>
      screen.getByRole("button", { name: "Show 20 more lines above" });
    fireEvent.click(arrow());
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    seedRange(queryClient, 10, 29, 80);
    fireEvent.click(arrow());

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(20));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names a read that threw as unavailable", async () => {
    renderHarness({ chunk: stubChunk(), view: "unified" });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Could not read the file right now. Try again.",
      ),
    );
    quiet.mockRestore();
  });

  it("focuses the first new line's right cell in split when the gap closes", async () => {
    const { view, queryClient } = renderHarness({
      chunk: stubShortChunk(),
      view: "split",
    });
    seedRange(queryClient, 1, 4, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show all 4 hidden lines above" }),
    );

    await waitFor(() =>
      expect(
        view.container.querySelectorAll(EXPANDED_RIGHT_NUMBER_SELECTOR),
      ).toHaveLength(4),
    );
    const number = view.container.querySelector(EXPANDED_RIGHT_NUMBER_SELECTOR);
    expect(number?.textContent).toBe("1");
    expect(document.activeElement).toBe(number?.nextElementSibling);
  });

  it("renders a hidden thread under the expanded row that shows its line", async () => {
    const { view, queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
      fileThreads: [stubHiddenThread(25)],
    });
    seedRange(queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(20));
    const thread = view.container.querySelector(
      'tr[data-conversation-thread="9025"]',
    );
    expect(numberCells(thread?.previousElementSibling ?? thread!)).toEqual([
      "28",
      "25",
    ]);
  });

  it("renders expanded rows full width in split view under the header", async () => {
    const { view, queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "split",
    });
    seedRange(queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(0));
    const cells = view.container.querySelectorAll(
      EXPANDED_RIGHT_NUMBER_SELECTOR,
    );
    expect(cells).toHaveLength(20);
    expect(cells[0]?.textContent).toBe("10");
    const controls = screen.getAllByTestId("expand-control");
    expect(controls.map((cell) => cell.getAttribute("colspan"))).toEqual([
      "6",
      "6",
    ]);
  });
});

describe("DiffTable comments across expanded rows", () => {
  async function expandAbove(
    chunk: BriefChunk,
    view: DiffView,
    session?: ReviewSessionPayload,
  ) {
    const harness = renderHarness({ chunk, view }, { session });
    seedRange(harness.queryClient, 10, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 20 more lines above" }),
    );
    await waitFor(() =>
      expect(
        harness.view.container.querySelectorAll(EXPANDED_ORIGIN_SELECTOR)
          .length,
      ).toBeGreaterThan(0),
    );
    return harness;
  }

  function stubDraft(): ReviewSessionPayload {
    return {
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "41",
          filePath: "src/a.ts",
          kind: "line",
          side: "new",
          startLine: 31,
          endLine: 31,
          body: "stays on thirty-one",
          status: "draft",
        },
      ],
    };
  }

  it("keeps a draft on new line 31 after twenty lines land above, unified", async () => {
    await expandAbove(stubChunk(), "unified", stubDraft());

    const row = screen.getByText("stays on thirty-one").closest("tr");
    expect(numberCells(row?.previousElementSibling ?? row!)).toEqual([
      "",
      "31",
    ]);
  });

  it("keeps a draft on new line 31 after twenty lines land above, split", async () => {
    await expandAbove(stubChunk(), "split", stubDraft());

    const row = screen.getByText("stays on thirty-one").closest("tr");
    const line = row?.previousElementSibling?.querySelector(
      'td[data-side="right"][data-line-number]',
    );
    expect(line?.textContent).toBe("31");
  });

  it("refuses the composer on an expanded row, unified", async () => {
    const { view, openCommentComposer } = await expandAbove(
      stubChunk(),
      "unified",
    );
    const row = expandedRows(view.container)[3]!;
    const sign = row.querySelector("[data-comment-anchor]")!;
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.mouseDown(sign);
    fireEvent.mouseUp(sign);
    const context = view.container.querySelector(
      `tr[data-line-kind="ctx"]${DIFF_ORIGIN_SELECTOR} [data-comment-anchor]`,
    )!;
    fireEvent.mouseDown(context);
    fireEvent.mouseEnter(sign);
    fireEvent.mouseUp(sign);

    expect(openCommentComposer).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(
      row.getAttribute("aria-describedby") ?? "",
    );
    expect(reason?.textContent).toBe(
      "Outside this chunk's diff; comments need one of its lines or a sibling span's.",
    );
    expect(
      view.container
        .querySelector(`tr[data-line-kind="ctx"]${DIFF_ORIGIN_SELECTOR}`)
        ?.getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("refuses the composer on an expanded row, split", async () => {
    const { view, openCommentComposer } = await expandAbove(
      stubChunk(),
      "split",
    );
    const number = view.container.querySelector(
      EXPANDED_RIGHT_NUMBER_SELECTOR,
    )!;
    const code = view.container.querySelector(
      `td${EXPANDED_ORIGIN_SELECTOR}[data-side="right"][class*="code"]`,
    )!;
    fireEvent.mouseDown(number);
    fireEvent.mouseUp(number);
    fireEvent.keyDown(code, { key: "Enter" });

    expect(openCommentComposer).not.toHaveBeenCalled();
    expect(code.getAttribute("aria-disabled")).toBe("true");
  });

  it("still anchors a changed line once context is expanded above it", async () => {
    const { view, openCommentComposer } = await expandAbove(
      stubChunk(),
      "unified",
    );
    const added = view.container.querySelector(
      'tr[data-line-kind="add"] [data-comment-anchor]',
    )!;
    fireEvent.mouseDown(added);
    fireEvent.mouseUp(added);

    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      side: "new",
      startLine: 31,
      endLine: 31,
      rowIds: ["c1:3"],
    });
  });
});
