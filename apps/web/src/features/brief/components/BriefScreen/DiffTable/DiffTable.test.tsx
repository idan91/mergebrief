// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThreadComposerWiring } from "@web/features/conversation";
import {
  buildInlineThreads,
  splitInlineRows,
} from "@web/features/conversation/utils/digest";
import type {
  ConversationThread,
  PrConversation,
} from "@web/features/conversation/types";
import {
  createReviewFlowStore,
  initialReviewFlowState,
  MindMapProvider,
  ReviewFlowProvider,
  type ReviewFlowState,
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
    role: "carrier",
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
    briefId: "db:42:7:base:head",
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
  chunks: [chunk()],
  concernView: [],
};

function renderTable(
  overrides: Partial<DiffTableProps> = {},
  flowState: Partial<ReviewFlowState> = {},
) {
  const rows =
    buildInlineThreads({
      conversation: conversation(),
      chunks: [chunk()],
      ownThreadIds: new Set(),
    }).get("c1") ?? [];
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
    },
    initialReviewFlowState({
      composerDisabledReason: undefined,
      flagsReadOnly: false,
      postingCommentIds: new Set(),
      postBlockedExternally: undefined,
      postComment: undefined,
    }),
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
      <MindMapProvider
        briefId="test-brief"
        model={buildBriefViewModel(providerBrief)}
      >
        <ReviewFlowProvider store={flowStore}>
          <DiffTable {...props} />
        </ReviewFlowProvider>
      </MindMapProvider>
    </QueryClientProvider>,
  );
  return { view, openCommentComposer, flowStore };
}

describe("DiffTable — read-only comment affordances", () => {
  const REASON = "You're viewing an earlier revision.";

  it("rows stay focusable but are aria-disabled with a reachable reason", () => {
    const { view } = renderTable({}, { composerDisabledReason: REASON });
    const row = view.container.querySelector('tr[aria-disabled="true"]');
    expect(row).not.toBeNull();
    // Still keyboard-reachable — the reason is discoverable BEFORE activation.
    expect(row?.getAttribute("tabindex")).toBe("0");
    const reasonId = row?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(reasonId)?.textContent).toBe(REASON);
    // The hover cue drops with the affordance.
    expect(view.container.querySelector("[data-commentable]")).toBeNull();
  });

  it("keeps composer entry inert on activation (Enter and click)", () => {
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

describe("DiffTable — selectable code text", () => {
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

  it("reserves the code column for text selection (no drag, no composer)", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) throw new Error("expected two diff rows");
    const code = first.querySelector("td:not([data-line-number])");
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
    const code = first?.querySelector("td:not([data-line-number])");
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
    const code = first?.querySelector("td:not([data-line-number])");
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

describe("DiffTable — row-level conversation threads", () => {
  it("renders the thread under its line with the jump-target attribute", () => {
    const {
      view: { container },
    } = renderTable();
    const row = container.querySelector('[data-conversation-thread="9001"]');
    expect(row).not.toBeNull();
    // The inline render must NOT emit the SECTION's landing attribute — and
    // vice versa — or one would shadow the other in document order.
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
    // Row-level detail hides the jump — the row already is the destination.
    expect(screen.queryByRole("button", { name: /Jump to/ })).toBeNull();
  });
});
