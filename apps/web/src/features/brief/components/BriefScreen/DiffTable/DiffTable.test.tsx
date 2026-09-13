// @vitest-environment jsdom
import { appI18n } from "../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThreadComposerWiring } from "@web/features/conversation";
import {
  buildInlineThreads,
  splitInlineRows,
} from "@web/features/conversation/utils";
import type {
  ConversationThread,
  PrConversation,
} from "@web/features/conversation/types";
import {
  createReviewFlowStore,
  emptySessionPayload,
  initialReviewFlowState,
  ReviewSessionProvider,
  ReviewFlowProvider,
  type ReviewFlowState,
  type ReviewFlowStore,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import type { Brief, BriefChunk } from "../../../types";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { DiffTable } from "./DiffTable";
import type { DiffTableProps } from "./types";

afterEach(cleanup);

function chunk(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "add", content: "b", newLine: 10 },
    ],
  } as BriefChunk;
}

/** A stored chunk: rows attach client-side, never from the artifact. */
function getDifflessChunks(one: BriefChunk): BriefChunk {
  const { diff: _rows, ...rest } = one;
  return rest;
}

function conversation(): PrConversation {
  const thread: ConversationThread = {
    rootCommentId: 9001,
    path: "src/a.ts",
    line: 10,
    side: "RIGHT",
    subjectType: "LINE",
    isResolved: false,
    isOutdated: false,
    comments: [
      {
        commentId: 9001,
        author: { login: "alice", isBot: false },
        body: "This null check looks inverted.",
        createdAt: "2026-07-01T10:00:00Z",
        url: "https://example.test/c/9001",
      },
    ],
    hasMoreComments: false,
  };
  return {
    threads: [thread],
    reviews: [],
    prComments: [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

function composer(): ThreadComposerWiring {
  return {
    post: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
    onPosted: vi.fn(),
  };
}

const providerBrief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "t",
    url: "https://example.com/pr/7",
    sha: "head1234",
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
  // Diff-less, like every stored artifact: rows attach client-side AFTER the
  // session store is built from this model.
  chunks: [getDifflessChunks(chunk())],
  concernView: [],
};

function renderTable(
  overrides: Partial<DiffTableProps> = {},
  flowState: Partial<ReviewFlowState> = {},
  existingStore?: ReviewFlowStore,
  session?: ReviewSessionPayload,
) {
  const rows =
    buildInlineThreads({
      conversation: conversation(),
      chunks: [chunk()],
      ownThreadIds: new Set(),
    }).get("c1") ?? [];
  const flowStore =
    existingStore ??
    createReviewFlowStore(
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
  flowStore.setState(flowState);
  // Call-count observability for composer entry: wrap the real action.
  const openCommentComposer = vi.fn(flowStore.getState().actions.openComposer);
  flowStore.setState({
    actions: {
      ...flowStore.getState().actions,
      openComposer: openCommentComposer,
    },
  });
  const props: DiffTableProps = {
    chunk: chunk(),
    comparisonView: { marks: new Map(), runs: [], runByRow: new Map() },
    comparisonSource: { kind: "last-review", delta: null },
    comparisonSkipReason: null,
    addressedComments: [],
    conversationThreadsByRow: splitInlineRows(rows).byRow,
    conversationComposer: composer(),
    reviewCommentLabel: "review comment",
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(providerBrief)}
        session={session}
      >
        <ReviewFlowProvider store={flowStore}>
          <DiffTable {...props} />
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );
  return { view, openCommentComposer, flowStore };
}

describe("DiffTable stable comparison column", () => {
  it("keeps the revision column when comparison is off", () => {
    const { view } = renderTable();

    expect(view.container.querySelectorAll("thead th")).toHaveLength(4);
    expect(
      view.container.querySelectorAll("tbody tr[data-line-kind]"),
    ).toHaveLength(2);
    for (const row of view.container.querySelectorAll(
      "tbody tr[data-line-kind]",
    )) {
      expect(row.querySelectorAll("td")).toHaveLength(4);
    }
    expect(view.container.querySelectorAll("[data-jump-target]")).toHaveLength(
      0,
    );
  });

  it("paints marked runs without changing the table structure", () => {
    const run = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [1],
      kind: "added" as const,
    };
    const { view } = renderTable({
      comparisonView: {
        marks: new Map([[1, "added"]]),
        runs: [run],
        runByRow: new Map([[1, run]]),
      },
    });

    expect(view.container.querySelectorAll("thead th")).toHaveLength(4);
    for (const row of view.container.querySelectorAll(
      "tbody tr[data-line-kind]",
    )) {
      expect(row.querySelectorAll("td")).toHaveLength(4);
    }
    expect(
      view.container.querySelectorAll('tbody td[data-rev="added"]'),
    ).toHaveLength(1);
    expect(view.container.querySelectorAll("[data-jump-target]")).toHaveLength(
      1,
    );
  });
});

describe("DiffTable draft restored from the server", () => {
  it("renders on the row its coordinates name, with no row ids to go on", () => {
    // The session read lands BEFORE the diff does, so a restored draft carries
    // coordinates and no row ids. Matching on ids alone would hide it, and a
    // draft the reviewer cannot see is one they write again.
    const session: ReviewSessionPayload = {
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "41",
          filePath: "src/a.ts",
          kind: "line",
          side: "new",
          startLine: 10,
          endLine: 10,
          body: "restored from the session",
          status: "draft",
        },
      ],
    };
    const { view } = renderTable({}, {}, undefined, session);
    expect(view.getByText("restored from the session")).toBeTruthy();
  });

  it("renders one whose line falls between the chunk's hunks", () => {
    // A chunk's OUTER span covers the gap between its hunks, so this draft
    // attaches to the chunk and then matches no rendered row. It used to
    // render nowhere at all, which is the same failure as a lost anchor.
    const multiHunk: BriefChunk = {
      ...chunk(),
      diff: [
        { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
        { kind: "add", content: "b", newLine: 10 },
        { kind: "hunk", content: "@@ -40,2 +40,2 @@" },
        { kind: "ctx", content: "c", oldLine: 40, newLine: 40 },
      ],
    };
    const session: ReviewSessionPayload = {
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "42",
          filePath: "src/a.ts",
          kind: "line",
          side: "new",
          startLine: 25,
          endLine: 25,
          body: "stranded between hunks",
          status: "draft",
        },
      ],
    };
    const { view } = renderTable({ chunk: multiHunk }, {}, undefined, session);
    expect(view.getByText("stranded between hunks")).toBeTruthy();
  });
});

describe("DiffTable read-only comment affordances", () => {
  const REASON = "You're viewing an earlier revision.";

  it("rows stay focusable but are aria-disabled with a reachable reason", () => {
    const { view } = renderTable({}, { composerDisabledReason: REASON });
    const row = view.container.querySelector('tr[aria-disabled="true"]');
    expect(row).not.toBeNull();
    // Still keyboard-reachable, so the reason is discoverable BEFORE activation.
    expect(row?.getAttribute("tabindex")).toBe("0");
    const reasonId = row?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(reasonId)?.textContent).toBe(REASON);
    // The hover cue drops with the affordance.
    expect(view.container.querySelector("[data-commentable]")).toBeNull();
  });

  it("keeps composer entry inert on Enter and on click", () => {
    const { view, openCommentComposer } = renderTable(
      {},
      { composerDisabledReason: REASON },
    );
    const row = view.container.querySelector('tr[aria-disabled="true"]');
    if (!(row instanceof HTMLElement)) throw new Error("expected a diff row");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.mouseDown(row);
    fireEvent.mouseUp(row);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("stays writable when no reason is given", () => {
    const { view, openCommentComposer } = renderTable();
    const row = view.container.querySelector("tr[data-commentable]");
    if (!(row instanceof HTMLElement)) throw new Error("expected a diff row");
    expect(row.getAttribute("aria-disabled")).toBeNull();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(openCommentComposer).toHaveBeenCalled();
  });
});

function commentableRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll("tr[data-commentable]"));
}

function selectTextIn(cell: Element) {
  const range = document.createRange();
  range.selectNodeContents(cell);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("DiffTable selectable code text", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
  });

  it("anchors a range from a line-number gutter drag", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) throw new Error("expected two diff rows");
    const gutter = first.querySelector("[data-line-number]");
    if (!(gutter instanceof HTMLElement)) throw new Error("expected a gutter");
    fireEvent.mouseDown(gutter);
    fireEvent.mouseEnter(second);
    // Both rows show the drag highlight while anchoring.
    expect(container.querySelectorAll("tr[data-selected]").length).toBe(2);
    fireEvent.mouseUp(second);
    expect(openCommentComposer).toHaveBeenCalledTimes(1);
  });

  it("anchors a single row from a plain gutter click", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first] = commentableRows(container);
    const gutter = first?.querySelector("[data-line-number]");
    if (!first || !(gutter instanceof HTMLElement)) {
      throw new Error("expected a gutter");
    }
    fireEvent.mouseDown(gutter);
    fireEvent.mouseUp(first);
    expect(openCommentComposer).toHaveBeenCalledTimes(1);
  });

  it("reserves the code column for text selection, no drag or composer", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) throw new Error("expected two diff rows");
    const code = first.querySelector("td:last-child");
    if (!(code instanceof HTMLElement)) throw new Error("expected a code cell");
    fireEvent.mouseDown(code);
    fireEvent.mouseEnter(second);
    expect(container.querySelector("tr[data-selected]")).toBeNull();
    // A double-click's first click lands here: never a composer.
    fireEvent.mouseUp(second);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("suppresses gutter mouseup at the end of a text-selection drag", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first] = commentableRows(container);
    const code = first?.querySelector("td:last-child");
    const gutter = first?.querySelector("[data-line-number]");
    if (!first || !(code instanceof Element) || !(gutter instanceof Element)) {
      throw new Error("expected code and gutter cells");
    }
    // Selection made during the drag (no gutter mousedown), released over
    // the gutter numbers.
    selectTextIn(code);
    fireEvent.mouseUp(gutter);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("anchors from the gutter despite a stale in-table selection", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    const code = first?.querySelector("td:last-child");
    const gutter = first?.querySelector("[data-line-number]");
    if (!second || !(code instanceof Element) || !(gutter instanceof Element)) {
      throw new Error("expected code and gutter cells");
    }
    // Copying code first must not kill the range affordance.
    selectTextIn(code);
    fireEvent.mouseDown(gutter);
    // The gutter mousedown drops the stale selection.
    expect(window.getSelection()?.isCollapsed ?? true).toBe(true);
    fireEvent.mouseEnter(second);
    fireEvent.mouseUp(second);
    expect(openCommentComposer).toHaveBeenCalledTimes(1);
  });
});

describe("DiffTable row-level conversation threads", () => {
  it("renders the thread under its line with the jump-target attribute", () => {
    const {
      view: { container },
    } = renderTable();
    const row = container.querySelector('[data-conversation-thread="9001"]');
    expect(row).not.toBeNull();
    // The inline render must NOT emit the SECTION's landing attribute, and
    // vice versa, or one would shadow the other in document order.
    expect(
      container.querySelector("[data-conversation-section-thread]"),
    ).toBeNull();
    // The disclosure inside the row is the focus target of the jump.
    const disclosure = screen.getByRole("button", {
      name: /This null check looks inverted/,
    });
    expect(row?.contains(disclosure)).toBe(true);
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    // Row-level detail hides the jump, because the row already is the target.
    expect(screen.queryByRole("button", { name: /Jump to/ })).toBeNull();
  });

  it("keeps expansion across unmount/remount when the store is shared", () => {
    // Virtualization unmounts far chunk cards; the expanded state must live
    // in the flow store, not the component, to survive the round trip.
    const first = renderTable();
    const disclosure = () =>
      screen.getByRole("button", { name: /This null check looks inverted/ });
    fireEvent.click(disclosure());
    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    first.view.unmount();

    const second = renderTable({}, {}, first.flowStore);
    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    second.view.unmount();
  });
});

function splitChunk(): BriefChunk {
  return {
    ...chunk(),
    diff: [
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "del", content: "old", oldLine: 10 },
      { kind: "add", content: "new", newLine: 10 },
      { kind: "add", content: "more", newLine: 11 },
    ],
  } as BriefChunk;
}

function twoHunkChunk(): BriefChunk {
  const base = splitChunk();
  return {
    ...base,
    diff: [
      { kind: "hunk", content: "@@ -9,3 +9,3 @@" },
      ...(base.diff ?? []),
      { kind: "hunk", content: "@@ -40,1 +41,1 @@" },
      { kind: "ctx", content: "tail", oldLine: 40, newLine: 41 },
    ],
  } as BriefChunk;
}

function sideCells(container: HTMLElement, side: string, kind: string) {
  const number = container.querySelector<HTMLElement>(
    `td[data-side="${side}"][data-line-number][data-line-kind="${kind}"]`,
  );
  const code = container.querySelector<HTMLElement>(
    `td[data-side="${side}"][class*="code"][data-line-kind="${kind}"]`,
  );
  if (!number || !code) throw new Error(`expected ${side} ${kind} cells`);
  return { number, code };
}

describe("DiffTable split selection", () => {
  it("anchors a left-side click on the old line", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const left = sideCells(container, "left", "del");
    fireEvent.mouseDown(left.number);
    fireEvent.mouseUp(left.number);

    expect(openCommentComposer).toHaveBeenCalledTimes(1);
    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      side: "old",
      startLine: 10,
      endLine: 10,
    });
    expect(openCommentComposer.mock.calls[0]?.[0]).not.toHaveProperty(
      "startSide",
    );
  });

  it("anchors a same-side drag on that side's lines only", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const first = sideCells(container, "right", "add");
    const rows = container.querySelectorAll(
      'td[data-side="right"][data-line-number]',
    );
    const last = rows[rows.length - 1];
    if (!(last instanceof HTMLElement)) throw new Error("expected a last cell");
    fireEvent.mouseDown(first.number);
    fireEvent.mouseEnter(last);
    expect(
      container.querySelectorAll('td[data-side="right"][data-selected]').length,
    ).toBe(4);
    expect(
      container.querySelectorAll('td[data-side="left"][data-selected]').length,
    ).toBe(0);
    fireEvent.mouseUp(last);

    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      side: "new",
      startLine: 10,
      endLine: 11,
    });
  });

  it("spans the unified range when a drag crosses sides", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const left = sideCells(container, "left", "del");
    const right = sideCells(container, "right", "add");
    fireEvent.mouseDown(left.number);
    fireEvent.mouseEnter(right.number);
    fireEvent.mouseUp(right.number);

    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      startSide: "old",
      side: "new",
      startLine: 10,
      endLine: 10,
    });
  });

  it("opens the composer under the side the anchor names", () => {
    const {
      view: { container },
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const left = sideCells(container, "left", "del");
    fireEvent.mouseDown(left.number);
    fireEvent.mouseUp(left.number);

    expect(container.querySelector('tr[data-placement="left"]')).not.toBeNull();
  });

  it("gives a context row one stop, on the right, and hops with the arrows", () => {
    const {
      view: { container },
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const leftCtx = sideCells(container, "left", "ctx");
    const rightCtx = sideCells(container, "right", "ctx");
    const left = sideCells(container, "left", "del");
    const right = sideCells(container, "right", "add");

    expect(leftCtx.code.getAttribute("tabindex")).toBe("-1");
    expect(rightCtx.code.getAttribute("tabindex")).toBe("0");
    left.code.focus();
    fireEvent.keyDown(left.code, { key: "ArrowRight" });
    expect(document.activeElement).toBe(right.code);
    fireEvent.keyDown(right.code, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(left.code);
  });

  it("anchors on Enter from the focused side's line", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const right = sideCells(container, "right", "add");
    fireEvent.keyDown(right.code, { key: "Enter" });

    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      side: "new",
      startLine: 10,
      endLine: 10,
    });
  });

  it("drops a same-side drag that crosses a hunk header", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: twoHunkChunk(), view: "split" });
    const numbers = container.querySelectorAll<HTMLElement>(
      'td[data-side="right"][data-line-number]',
    );
    const first = numbers[0];
    const last = numbers[numbers.length - 1];
    if (!first || !last) throw new Error("expected right-side cells");
    fireEvent.mouseDown(first);
    fireEvent.mouseEnter(last);
    expect(container.querySelectorAll("td[data-selected]").length).toBe(0);
    fireEvent.mouseUp(last);

    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("anchors a plain click on a left context cell to the old line", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const leftCtx = sideCells(container, "left", "ctx");
    fireEvent.mouseUp(leftCtx.number);

    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      side: "old",
      startLine: 9,
      endLine: 9,
    });
  });

  it("spans a crossing composer across the whole row", () => {
    const {
      view: { container },
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const left = sideCells(container, "left", "del");
    const right = sideCells(container, "right", "add");
    fireEvent.mouseDown(left.number);
    fireEvent.mouseEnter(right.number);
    fireEvent.mouseUp(right.number);
    const row = container.querySelector("textarea")?.closest("tr");
    const columns = container.querySelectorAll("colgroup col").length;

    expect(row?.getAttribute("data-placement")).toBeNull();
    expect(row?.querySelector("td")?.colSpan).toBe(columns);
  });

  it("refuses a crossing drag that spans a hunk header", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: twoHunkChunk(), view: "split" });
    const numbers = container.querySelectorAll<HTMLElement>(
      "td[data-line-number]",
    );
    const first = numbers[1];
    const last = numbers[numbers.length - 1];
    if (!first || !last) throw new Error("expected number cells");
    fireEvent.mouseDown(first);
    fireEvent.mouseEnter(last);
    expect(container.querySelectorAll("td[data-selected]").length).toBe(0);
    fireEvent.mouseUp(last);

    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("insets a left card past the rail and its numbers", () => {
    const {
      view: { container },
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const left = sideCells(container, "left", "del");
    fireEvent.mouseDown(left.number);
    fireEvent.mouseUp(left.number);
    const row = container.querySelector('tr[data-placement="left"]');
    const cells = Array.from(row?.querySelectorAll("td") ?? []);
    const columns = container.querySelectorAll("colgroup col").length;

    expect(cells.map((cell) => cell.colSpan)).toEqual([columns - 2, 2]);
  });

  it("lays a side thread beside its side and a gap the other way", () => {
    const {
      view: { container },
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const right = sideCells(container, "right", "add");
    fireEvent.mouseDown(right.number);
    fireEvent.mouseUp(right.number);
    const row = container.querySelector('tr[data-placement="right"]');
    const cells = Array.from(row?.querySelectorAll("td") ?? []);
    const columns = container.querySelectorAll("colgroup col").length;

    expect(cells.map((cell) => cell.colSpan)).toEqual([columns - 2, 2]);
  });

  it("renders a restored crossing draft across the whole row", () => {
    const session: ReviewSessionPayload = {
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "43",
          filePath: "src/a.ts",
          kind: "line",
          side: "new",
          startSide: "old",
          startLine: 10,
          endLine: 10,
          body: "crossing draft",
          status: "draft",
        },
      ],
    };
    renderTable({ chunk: splitChunk(), view: "split" }, {}, undefined, session);
    const row = screen.getByText("crossing draft").closest("tr");

    expect(row?.getAttribute("data-placement")).toBeNull();
  });

  it("carries the read-only reason on the focusable cell of each side", () => {
    const REASON = "You're viewing an earlier revision.";
    const {
      view: { container },
    } = renderTable(
      { chunk: splitChunk(), view: "split" },
      { composerDisabledReason: REASON },
    );
    const left = sideCells(container, "left", "del");
    const leftCtx = sideCells(container, "left", "ctx");

    expect(container.querySelector("tr[aria-disabled]")).toBeNull();
    expect(left.code.getAttribute("aria-disabled")).toBe("true");
    const reasonId = left.code.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(reasonId)?.textContent).toBe(REASON);
    expect(leftCtx.code.getAttribute("aria-disabled")).toBe("true");
  });

  it("anchors Enter on the left context cell to the old line", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const rightCtx = sideCells(container, "right", "ctx");
    const leftCtx = sideCells(container, "left", "ctx");
    rightCtx.code.focus();
    fireEvent.keyDown(rightCtx.code, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(leftCtx.code);
    fireEvent.keyDown(leftCtx.code, { key: "Enter" });

    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      side: "old",
      startLine: 9,
      endLine: 9,
    });
  });

  it("lays a left-side context thread under the old half", () => {
    const thread: ConversationThread = {
      ...conversation().threads[0]!,
      rootCommentId: 9002,
      line: 9,
      side: "LEFT",
    };
    const rows =
      buildInlineThreads({
        conversation: { ...conversation(), threads: [thread] },
        chunks: [splitChunk()],
        ownThreadIds: new Set(),
      }).get("c1") ?? [];
    const {
      view: { container },
    } = renderTable({
      chunk: splitChunk(),
      view: "split",
      conversationThreadsByRow: splitInlineRows(rows).byRow,
    });
    const row = container.querySelector('tr[data-conversation-thread="9002"]');

    expect(row?.getAttribute("data-placement")).toBe("left");
  });

  it("keeps a text selection begun on one side off the other", () => {
    const {
      view: { container },
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const left = sideCells(container, "left", "del");
    fireEvent.mouseDown(left.code);

    expect(
      container.querySelector("table")?.getAttribute("data-selecting"),
    ).toBe("left");
    fireEvent.mouseUp(window);
    expect(
      container.querySelector("table")?.getAttribute("data-selecting"),
    ).toBeNull();
  });
});
