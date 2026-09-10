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
import { DiffTable, type DiffTableProps } from "./DiffTable";

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
