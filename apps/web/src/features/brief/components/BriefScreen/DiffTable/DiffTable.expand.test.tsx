// @vitest-environment jsdom
import { appI18n } from "../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReviewFlowStore,
  emptySessionPayload,
  initialReviewFlowState,
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
import { fileRangeQueryKey, type FileRangeResult } from "../../../queries";
import { useExpandedRows } from "../../../hooks/useExpandedRows";
import {
  ExpansionSourceProvider,
  type ExpansionSource,
} from "../../../hooks/useExpansionSource";
import type { DigestThreadRow } from "@web/features/conversation/utils";
import type { Brief, BriefChunk, LineRange } from "../../../types";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { DiffTable } from "./DiffTable";

afterEach(cleanup);

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

/** A chunk whose only hole above is short enough to close in one click. */
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

/** One hunk sliced around another chunk's rows: a hole with no header. */
function stubInnerHoleChunk(): BriefChunk {
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

/** A new file sliced with a hole: additions on both sides of it. */
function stubNewFileHoleChunk(): BriefChunk {
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

function stubBrief(chunk: BriefChunk): Brief {
  const { diff: _rows, ...stored } = chunk;
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
    ],
    chunks: [stored],
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
  const key = fileRangeQueryKey({
    repoId: SOURCE.repoId,
    prNumber: SOURCE.prNumber,
    ref: HEAD,
    path: "src/a.ts",
    from,
    to,
  });
  const lines: string[] = [];
  for (let line = from; line <= to; line += 1) lines.push(`L${line}`);
  const ready: FileRangeResult = {
    kind: "ready",
    range: { path: "src/a.ts", ref: HEAD, from, to, lines, totalLines },
  };
  queryClient.setQueryData(key, result ?? ready);
}

interface HarnessProps {
  chunk: BriefChunk;
  view: DiffView;
  claimed?: readonly LineRange[];
  hiddenThreads?: readonly DigestThreadRow[];
}

function stubHiddenThread(line: number): DigestThreadRow {
  return {
    kind: "thread",
    thread: {
      rootCommentId: 9000 + line,
      path: "src/a.ts",
      line,
      side: "RIGHT",
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

const NO_CLAIMED: LineRange[] = [];
const COMPOSER = {
  post: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
  onPosted: vi.fn(),
};

function Harness({
  chunk,
  view,
  claimed = NO_CLAIMED,
  hiddenThreads,
}: HarnessProps) {
  const expansion = useExpandedRows({
    chunkId: chunk.id,
    path: chunk.file,
    rows: chunk.diff ?? [],
    claimed,
  });
  return (
    <DiffTable
      addressedComments={[]}
      chunk={chunk}
      claimed={claimed}
      comparisonSkipReason={null}
      comparisonSource={{ kind: "last-review", delta: null }}
      comparisonView={{ marks: new Map(), runs: [], runByRow: new Map() }}
      conversationComposer={COMPOSER}
      expansion={expansion}
      hiddenThreads={hiddenThreads}
      reviewCommentLabel="review comment"
      view={view}
    />
  );
}

function renderHarness(
  props: HarnessProps,
  options: {
    source?: ExpansionSource | undefined;
    session?: ReviewSessionPayload | undefined;
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
    initialReviewFlowState({
      composerDisabledReason: undefined,
      flagsReadOnly: false,
      postingCommentIds: new Set(),
      postBlockedExternally: undefined,
      postComment: undefined,
    }),
    appI18n.t,
  );
  const openCommentComposer = vi.fn(flowStore.getState().actions.openComposer);
  flowStore.setState({
    actions: {
      ...flowStore.getState().actions,
      openComposer: openCommentComposer,
    },
  });
  const source = "source" in options ? options.source : SOURCE;
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ExpansionSourceProvider source={source}>
        <ReviewSessionProvider
          briefId="test-brief"
          model={buildBriefViewModel(stubBrief(props.chunk))}
          session={options.session}
        >
          <ReviewFlowProvider store={flowStore}>
            <Harness {...props} />
          </ReviewFlowProvider>
        </ReviewSessionProvider>
      </ExpansionSourceProvider>
    </QueryClientProvider>,
  );
  return { view, queryClient, flowStore, openCommentComposer };
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
    const down = screen.getByRole("button", {
      name: "Show 20 more lines below",
    });
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

  it("counts the shipped threads the hole hides", () => {
    renderHarness({
      chunk: stubChunk(),
      view: "unified",
      hiddenThreads: [12, 20, 45].map(stubHiddenThread),
    });

    expect(
      screen.getByRole("button", { name: "2 comments in the hidden lines" }),
    ).toBeTruthy();
  });

  it("leaves out a thread another chunk's rows keep out of reach", () => {
    renderHarness({
      chunk: stubChunk(),
      view: "unified",
      claimed: [{ start: 10, end: 28 }],
      hiddenThreads: [20].map(stubHiddenThread),
    });

    expect(screen.queryByRole("button", { name: /hidden lines/ })).toBeNull();
  });

  it("counts and reveals only the hidden threads a sibling has not claimed", async () => {
    const { view, queryClient } = renderHarness({
      chunk: stubChunk(),
      view: "unified",
      claimed: [{ start: 20, end: 24 }],
      hiddenThreads: [22, 27].map(stubHiddenThread),
    });
    expect(
      screen.getByRole("button", { name: "1 comment in the hidden lines" }),
    ).toBeTruthy();
    seedRange(queryClient, 25, 29, 80);
    fireEvent.click(
      screen.getByRole("button", { name: "Show all 5 hidden lines above" }),
    );

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(5));
    expect(
      view.container.querySelector('tr[data-conversation-thread="9027"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelector('tr[data-conversation-thread="9022"]'),
    ).toBeNull();
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
      chunk: stubChunk(),
      view: "unified",
      claimed: [{ start: 1, end: 20 }],
    });
    seedRange(queryClient, 21, 29, 80);
    const arrow = screen.getByRole("button", {
      name: "Show all 9 hidden lines above",
    });
    arrow.focus();
    fireEvent.click(arrow);

    await waitFor(() => expect(expandedRows(view.container)).toHaveLength(9));
    expect(
      view.container.querySelector('tr[data-line-kind="hunk"]'),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: /lines above/ })).toBeNull();
    expect(document.activeElement).toBe(expandedRows(view.container)[0]);
  });

  it("reads once when the arrow is activated twice before rows land", async () => {
    const { view, queryClient, flowStore } = renderHarness({
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
    const edges = [...flowStore.getState().expandedEdges.values()];
    expect(edges.map((edge) => edge.range)).toEqual([{ start: 33, end: 52 }]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a headerless hole's control in place in split and keys rows once", async () => {
    const holed = {
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
      chunk: holed,
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
    // The inner hole's arrow comes first; the tail's is the second one.
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

  it("shares one note when both arrows of a hole fail the same way", async () => {
    const { queryClient } = renderHarness({
      chunk: stubInnerHoleChunk(),
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

  it("offers no expander for a hole inside a new file", () => {
    renderHarness({ chunk: stubNewFileHoleChunk(), view: "unified" });

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
      hiddenThreads: [25].map(stubHiddenThread),
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
      "5",
      "5",
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
    const number = row.querySelector("[data-line-number]")!;
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.mouseDown(number);
    fireEvent.mouseUp(number);
    const context = view.container.querySelector(
      `tr[data-line-kind="ctx"]${DIFF_ORIGIN_SELECTOR} [data-line-number]`,
    )!;
    fireEvent.mouseDown(context);
    fireEvent.mouseEnter(number);
    fireEvent.mouseUp(number);

    expect(openCommentComposer).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(
      row.getAttribute("aria-describedby") ?? "",
    );
    expect(reason?.textContent).toBe(
      "Outside the diff; comments need a changed line.",
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
      'tr[data-line-kind="add"] [data-line-number]',
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
