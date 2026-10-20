// @vitest-environment jsdom
import { appI18n } from "../../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MentionCandidateKinds } from "@web/components/MarkdownTextarea/types";
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
  ReviewSessionProvider,
  ReviewFlowProvider,
  type ReviewFlowState,
  type ReviewFlowStore,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import type { Brief, BriefChunk } from "../../../../model/types";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { DiffTable } from ".";
import type { DiffTableProps } from "./types";
import { createCommentAnchor } from "@web/features/review/utils";
import {
  ReviewPostureProvider,
  type ReviewPosture,
} from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";

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

interface TableState extends Partial<ReviewFlowState> {
  posture?: Partial<ReviewPosture>;
}

function renderTable(
  overrides: Partial<DiffTableProps> = {},
  state: TableState = {},
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
      appI18n.t,
    );
  const { posture = {}, ...flowState } = state;
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
  const tree = (next: DiffTableProps) => (
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(providerBrief)}
        session={session}
      >
        <ReviewFlowProvider store={flowStore}>
          <ReviewPostureProvider posture={makeReviewPosture(posture)}>
            <DiffTable {...next} />
          </ReviewPostureProvider>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>
  );
  const view = render(tree(props));
  const setProps = (patch: Partial<DiffTableProps>) =>
    view.rerender(tree({ ...props, ...patch }));

  return { view, openCommentComposer, flowStore, setProps };
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

  it("names the seam column in the split header", () => {
    const run = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [1],
      kind: "added" as const,
    };
    const { view } = renderTable({
      chunk: splitChunk(),
      comparisonView: {
        marks: new Map([[1, "added"]]),
        runs: [run],
        runByRow: new Map([[1, run]]),
      },
      view: "split",
    });
    const headers = [...view.container.querySelectorAll("thead th")].map(
      (header) => header.textContent,
    );

    expect(headers).toEqual([
      "Revision",
      "Old line",
      "Removed content",
      "Revision, new side",
      "New line",
      "Added content",
    ]);
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

describe("DiffTable revision rail callout", () => {
  it("keeps the next row's callout when the previous row's hover closes", () => {
    const run = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [0, 1],
      kind: "added" as const,
    };
    const { view } = renderTable({
      comparisonView: {
        marks: new Map([
          [0, "added"],
          [1, "added"],
        ]),
        runs: [run],
        runByRow: new Map([
          [0, run],
          [1, run],
        ]),
      },
    });
    const [first, second] = view.container.querySelectorAll(
      'tbody td[data-rev="added"]',
    );
    if (!first || !second) {
      throw new Error("expected two rail cells");
    }
    const jump = view.container.querySelector("[data-jump-target]");
    if (!jump) {
      throw new Error("expected the rail jump button");
    }

    fireEvent.focus(jump);
    fireEvent.mouseEnter(second);
    fireEvent.blur(jump);

    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("a drag released over the rail button still lands the selection", () => {
    const run = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [0, 1],
      kind: "added" as const,
    };
    const { view, flowStore } = renderTable({
      comparisonView: {
        marks: new Map([
          [0, "added"],
          [1, "added"],
        ]),
        runs: [run],
        runByRow: new Map([
          [0, run],
          [1, run],
        ]),
      },
    });
    const [first, second] = commentableRows(view.container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    const jump = view.container.querySelector("[data-jump-target]");
    if (!jump) {
      throw new Error("expected the rail jump button");
    }

    fireEvent.mouseDown(findNumberCell(second));
    fireEvent.mouseEnter(first);
    fireEvent.mouseUp(jump);

    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 9,
      endLine: 10,
    });
  });

  it("Space on the rail button never selects a line", () => {
    const run = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [0, 1],
      kind: "added" as const,
    };
    const { view, flowStore } = renderTable({
      comparisonView: {
        marks: new Map([
          [0, "added"],
          [1, "added"],
        ]),
        runs: [run],
        runByRow: new Map([
          [0, run],
          [1, run],
        ]),
      },
    });
    const jump = view.container.querySelector("[data-jump-target]");
    if (!jump) {
      throw new Error("expected the rail jump button");
    }

    fireEvent.keyDown(jump, { key: " " });
    fireEvent.keyDown(jump, { key: "Enter" });

    expect(flowStore.getState().lineSelection).toBeNull();
    expect(flowStore.getState().composerAnchor).toBeNull();
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

describe("DiffTable re-anchor pick affordance", () => {
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
        body: "carried draft",
        status: "draft",
      },
    ],
  };

  it("marks commentable rows pickable in the armed draft's file", () => {
    const { view } = renderTable(
      {},
      { reanchorDraftId: "41" },
      undefined,
      session,
    );
    const rows = commentableRows(view.container);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.getAttribute("data-pick")).toBe("available");
    }
  });

  it("leaves another file's rows inert and marked unavailable", () => {
    const otherFile: BriefChunk = { ...chunk(), id: "c2", file: "src/b.ts" };
    const { view, openCommentComposer } = renderTable(
      { chunk: otherFile },
      { reanchorDraftId: "41" },
      undefined,
      session,
    );
    const rows = [...view.container.querySelectorAll("tr[data-pick]")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.getAttribute("data-pick")).toBe("unavailable");
      expect(row.getAttribute("aria-disabled")).toBe("true");
      expect(row.getAttribute("aria-describedby")).toBe("reanchor-hint");
    }
    const sign = view.container.querySelector("[data-comment-anchor]");
    fireEvent.mouseDown(sign as Element);
    fireEvent.mouseUp(sign as Element);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("carries no pick state once the armed draft no longer exists", () => {
    // A draft deleted from its thread, or submitted, leaves the id behind;
    // the mode reads the draft itself, as the banner does.
    const { view } = renderTable(
      {},
      { reanchorDraftId: "gone" },
      undefined,
      session,
    );
    expect(view.container.querySelector("[data-pick]")).toBeNull();
  });

  it("carries no pick state while nothing is armed", () => {
    const { view } = renderTable({}, {}, undefined, session);
    expect(view.container.querySelector("[data-pick]")).toBeNull();
  });
});

describe("DiffTable read-only comment affordances", () => {
  const REASON = "You're viewing an earlier revision.";

  it("rows stay focusable but are aria-disabled with a reachable reason", () => {
    const { view } = renderTable(
      {},
      { posture: { composerDisabledReason: REASON } },
    );
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
      { posture: { composerDisabledReason: REASON } },
    );
    const row = view.container.querySelector('tr[aria-disabled="true"]');
    if (!(row instanceof HTMLElement)) {
      throw new Error("expected a diff row");
    }
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.mouseDown(row);
    fireEvent.mouseUp(row);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("refuses composer entry on a row read from the file", () => {
    const expanded: BriefChunk = {
      ...chunk(),
      diff: [
        {
          kind: "ctx",
          origin: "expanded",
          content: "read",
          oldLine: 8,
          newLine: 8,
        },
        { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      ],
    };
    const { view, openCommentComposer } = renderTable({ chunk: expanded });
    const rows = view.container.querySelectorAll("tbody tr");
    const row = rows[0];
    if (!(row instanceof HTMLElement)) {
      throw new Error("expected a diff row");
    }

    expect(row.getAttribute("data-commentable")).toBeNull();
    expect(row.getAttribute("aria-describedby")).toBeNull();
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.mouseDown(row);
    fireEvent.mouseUp(row);

    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("stays writable when no reason is given", () => {
    const { view, openCommentComposer } = renderTable();
    const row = view.container.querySelector("tr[data-commentable]");
    if (!(row instanceof HTMLElement)) {
      throw new Error("expected a diff row");
    }
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

  it("anchors a range from a sign-column drag", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findSignSpan(first));
    fireEvent.mouseEnter(second);
    // Both rows show the drag highlight while anchoring.
    expect(container.querySelectorAll("tr[data-selected]").length).toBe(2);
    fireEvent.mouseUp(second);
    expect(openCommentComposer).toHaveBeenCalledTimes(1);
  });

  it("anchors a single row from a plain sign click", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first] = commentableRows(container);
    if (!first) {
      throw new Error("expected a diff row");
    }
    fireEvent.mouseDown(findSignSpan(first));
    fireEvent.mouseUp(first);
    expect(openCommentComposer).toHaveBeenCalledTimes(1);
  });

  it("reserves the code column for text selection, no drag or composer", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    const code = first.querySelector("td:last-child");
    if (!(code instanceof HTMLElement)) {
      throw new Error("expected a code cell");
    }
    fireEvent.mouseDown(code);
    fireEvent.mouseEnter(second);
    expect(container.querySelector("tr[data-selected]")).toBeNull();
    // A double-click's first click lands here: never a composer.
    fireEvent.mouseUp(second);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("suppresses sign mouseup at the end of a text-selection drag", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first] = commentableRows(container);
    const code = first?.querySelector("td:last-child");
    if (!first || !(code instanceof Element)) {
      throw new Error("expected a code cell");
    }
    // Selection made during the drag (no sign mousedown), released over
    // the sign.
    selectTextIn(code);
    fireEvent.mouseUp(findSignSpan(first));
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("anchors from the sign despite a stale in-table selection", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    const code = first?.querySelector("td:last-child");
    if (!first || !second || !(code instanceof Element)) {
      throw new Error("expected a code cell");
    }
    // Copying code first must not kill the range affordance.
    selectTextIn(code);
    fireEvent.mouseDown(findSignSpan(first));
    // The sign mousedown drops the stale selection.
    expect(window.getSelection()?.isCollapsed ?? true).toBe(true);
    fireEvent.mouseEnter(second);
    fireEvent.mouseUp(second);
    expect(openCommentComposer).toHaveBeenCalledTimes(1);
  });
});

function findNumberCell(row: HTMLElement): HTMLElement {
  const cell = row.querySelector("[data-select-anchor]");
  if (!(cell instanceof HTMLElement)) {
    throw new Error("expected a number cell");
  }
  return cell;
}

function findSignSpan(row: HTMLElement): HTMLElement {
  const sign = row.querySelector("[data-comment-anchor]");
  if (!(sign instanceof HTMLElement)) {
    throw new Error("expected a sign");
  }
  return sign;
}

describe("DiffTable line selection", () => {
  it("a number pick places the draft while a re-anchor is armed", () => {
    const {
      view: { container },
      flowStore,
      openCommentComposer,
    } = renderTable({}, { reanchorDraftId: "41" }, undefined, {
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "41",
          filePath: "src/a.ts",
          kind: "line",
          side: "new",
          startLine: 10,
          endLine: 10,
          body: "carried draft",
          status: "draft",
        },
      ],
    });
    const [, second] = commentableRows(container);
    if (!second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(second));
    fireEvent.mouseUp(second);

    expect(openCommentComposer).toHaveBeenCalledTimes(1);
    expect(flowStore.getState().lineSelection).toBeNull();
  });

  it("a sign click inside a unified selection over a deletion comments on it", () => {
    const {
      view: { container },
      flowStore,
      openCommentComposer,
    } = renderTable({ chunk: splitChunk() });
    const rows = commentableRows(container);
    const [ctx, del, add] = rows;
    if (!ctx || !del || !add) {
      throw new Error("expected three diff rows");
    }
    fireEvent.mouseDown(findNumberCell(ctx));
    fireEvent.mouseEnter(add);
    fireEvent.mouseUp(add);
    expect(flowStore.getState().lineSelection).toMatchObject({
      side: "new",
      startLine: 9,
      endLine: 10,
    });
    expect(del.hasAttribute("data-selected")).toBe(true);

    fireEvent.mouseDown(findSignSpan(del));
    fireEvent.mouseUp(findSignSpan(del));

    expect(openCommentComposer).toHaveBeenCalledTimes(1);
    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      side: "new",
      startLine: 9,
      endLine: 10,
    });
  });

  it("Enter on a selected row comments on the whole selection", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseEnter(second);
    fireEvent.mouseUp(second);

    fireEvent.keyDown(second, { key: "Enter" });

    expect(openCommentComposer).toHaveBeenCalledTimes(1);
    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      startLine: 9,
      endLine: 10,
    });
  });

  it("a number click selects that line into the store", () => {
    const {
      view: { container },
      flowStore,
      openCommentComposer,
    } = renderTable();
    const [, second] = commentableRows(container);
    if (!second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(second));
    fireEvent.mouseUp(second);

    expect(flowStore.getState().lineSelection).toEqual({
      chunkId: "c1",
      file: "src/a.ts",
      side: "new",
      startLine: 10,
      endLine: 10,
      rowIds: ["c1:1"],
    });
    expect(second.hasAttribute("data-selected")).toBe(true);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("a number drag selects the range", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseEnter(second);
    fireEvent.mouseUp(second);

    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 9,
      endLine: 10,
    });
    expect(container.querySelectorAll("tr[data-selected]")).toHaveLength(2);
  });

  it("shift-click extends from the selection's first line", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseUp(first);
    fireEvent.mouseDown(findNumberCell(second), { shiftKey: true });

    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 9,
      endLine: 10,
    });
  });

  it("a sign click inside the selection opens the composer on all of it", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseEnter(second);
    fireEvent.mouseUp(second);
    fireEvent.mouseDown(findSignSpan(second));
    fireEvent.mouseUp(findSignSpan(second));

    expect(openCommentComposer).toHaveBeenCalledTimes(1);
    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      startLine: 9,
      endLine: 10,
    });
  });

  it("a sign click outside the selection anchors that row alone", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseUp(first);
    fireEvent.mouseDown(findSignSpan(second));
    fireEvent.mouseUp(findSignSpan(second));

    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      startLine: 10,
      endLine: 10,
    });
  });

  it("Escape clears the selection and leaves focus where it is", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable();
    const [first] = commentableRows(container);
    if (!first) {
      throw new Error("expected a diff row");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseUp(first);
    first.focus();
    fireEvent.keyDown(first, { key: "Escape" });

    expect(flowStore.getState().lineSelection).toBeNull();
    expect(document.activeElement).toBe(first);
    expect(first.hasAttribute("data-selected")).toBe(false);
  });

  it("a click on the code clears the selection", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseUp(first);
    const code = second.querySelector("td:last-child");
    if (!(code instanceof HTMLElement)) {
      throw new Error("expected a code cell");
    }
    fireEvent.mouseDown(code);

    expect(flowStore.getState().lineSelection).toBeNull();
  });

  it("Space selects the focused row and Shift+Space extends", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.keyDown(first, { key: " " });
    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 9,
      endLine: 9,
    });
    fireEvent.keyDown(second, { key: " ", shiftKey: true });
    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 9,
      endLine: 10,
    });
  });

  it("the composer range wins over the selection while a composer is open", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseUp(first);
    const anchor = createCommentAnchor(
      "c1",
      "src/a.ts",
      chunk().diff ?? [],
      [1],
    );
    if (anchor === null) {
      throw new Error("expected an anchor");
    }
    act(() => flowStore.getState().actions.openComposer(anchor, undefined));

    expect(first.hasAttribute("data-selected")).toBe(false);
    expect(second.hasAttribute("data-selected")).toBe(true);
    act(() => flowStore.getState().actions.cancelComposer());
    expect(first.hasAttribute("data-selected")).toBe(true);
  });

  it("selects the old line from a left number cell in split view", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const left = sideCells(container, "left", "del");
    fireEvent.mouseDown(left.number);
    fireEvent.mouseUp(left.number);

    expect(flowStore.getState().lineSelection).toMatchObject({
      side: "old",
      startLine: 10,
      endLine: 10,
    });
    expect(
      container.querySelectorAll('td[data-side="left"][data-selected]'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('td[data-side="right"][data-selected]'),
    ).toHaveLength(0);
  });

  it("Enter or Space on the link glyph never touches the selection", () => {
    const {
      view: { container },
      flowStore,
      openCommentComposer,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseEnter(second);
    fireEvent.mouseUp(second);
    const before = flowStore.getState().lineSelection;
    const glyph = container.querySelector(
      '[data-testid="line-link-button"] button',
    );
    if (!(glyph instanceof HTMLElement)) {
      throw new Error("expected the glyph");
    }

    fireEvent.keyDown(glyph, { key: "Enter" });
    fireEvent.keyDown(glyph, { key: " " });

    expect(flowStore.getState().lineSelection).toBe(before);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("shows the link button at the first selected row, and nowhere else", () => {
    const {
      view: { container },
    } = renderTable();
    expect(
      container.querySelector('[data-testid="line-link-button"]'),
    ).toBeNull();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseEnter(second);
    fireEvent.mouseUp(second);

    const glyphs = container.querySelectorAll(
      '[data-testid="line-link-button"]',
    );
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]?.closest("tr")).toBe(first);
    expect(glyphs[0]?.closest("td")?.hasAttribute("data-line-new")).toBe(true);
    const button = screen.getByRole("button", {
      name: "Copy link to lines 9 to 10",
    });
    expect(button.textContent).toContain("9");
  });

  it("a click on the link button keeps the selection", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const {
      view: { container },
      flowStore,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseEnter(second);
    fireEvent.mouseUp(second);
    const glyph = screen.getByRole("button", {
      name: "Copy link to lines 9 to 10",
    });
    fireEvent.mouseDown(glyph);
    fireEvent.mouseUp(glyph);
    fireEvent.click(glyph);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringMatching(/[?&]l=c1\.R9-R10$/),
      ),
    );
    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 9,
      endLine: 10,
    });
  });

  it("hides the glyph while a composer is open", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable();
    const [first, second] = commentableRows(container);
    if (!first || !second) {
      throw new Error("expected two diff rows");
    }
    fireEvent.mouseDown(findNumberCell(first));
    fireEvent.mouseUp(first);
    const anchor = createCommentAnchor(
      "c1",
      "src/a.ts",
      chunk().diff ?? [],
      [1],
    );
    if (anchor === null) {
      throw new Error("expected an anchor");
    }
    act(() => flowStore.getState().actions.openComposer(anchor, undefined));

    expect(
      container.querySelector('[data-testid="line-link-button"]'),
    ).toBeNull();
  });

  it("puts the link button on the old side in split view", () => {
    const {
      view: { container },
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const left = sideCells(container, "left", "del");
    fireEvent.mouseDown(left.number);
    fireEvent.mouseUp(left.number);

    const glyph = container.querySelector('[data-testid="line-link-button"]');
    expect(glyph?.closest("td")?.getAttribute("data-side")).toBe("left");
  });

  it("selects lines on a read-only revision, where no comment can", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable({}, { posture: { composerDisabledReason: "Read-only." } });
    const row = container.querySelector("tr[data-line-kind='add']");
    if (!(row instanceof HTMLElement)) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(findNumberCell(row));
    fireEvent.mouseUp(row);

    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 10,
    });
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

function makeMentionComposer(): ThreadComposerWiring {
  return {
    ...composer(),
    mentionSource: {
      participants: [{ kind: MentionCandidateKinds.USER, login: "carol" }],
    },
  };
}

function readOptionLabels(): (string | undefined)[] {
  const options = screen.getAllByRole("option");
  const labels = options.map((option) => option.textContent?.trim());
  return labels;
}

describe("DiffTable mention source hand-off", () => {
  it("offers the conversation's participants in the line composer", () => {
    const { flowStore } = renderTable({
      conversationComposer: makeMentionComposer(),
    });
    const anchor = createCommentAnchor(
      "c1",
      "src/a.ts",
      chunk().diff ?? [],
      [1],
    );
    if (anchor === null) {
      throw new Error("expected an anchor");
    }
    act(() => flowStore.getState().actions.openComposer(anchor, undefined));

    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "@" },
    });
    expect(readOptionLabels()).toEqual(["@carol"]);
  });

  it("offers the conversation's participants in a row draft's editor", () => {
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
          body: "row draft",
          status: "draft",
        },
      ],
    };
    renderTable(
      { conversationComposer: makeMentionComposer() },
      {},
      undefined,
      session,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit comment"), {
      target: { value: "@" },
    });
    expect(readOptionLabels()).toEqual(["@carol"]);
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
  const sign = code?.querySelector<HTMLElement>("[data-comment-anchor]");
  if (!number || !code || !sign) {
    throw new Error(`expected ${side} ${kind} cells`);
  }
  return { number, code, sign };
}

describe("DiffTable split selection", () => {
  it("shift-click extends a right-side selection on that side only", () => {
    const {
      view: { container },
      flowStore,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const first = sideCells(container, "right", "add");
    const numbers = container.querySelectorAll(
      'td[data-side="right"][data-line-number]',
    );
    const last = numbers[numbers.length - 1];
    if (!(last instanceof HTMLElement)) {
      throw new Error("expected a last cell");
    }
    fireEvent.mouseDown(first.number);
    fireEvent.mouseUp(first.number);
    fireEvent.mouseDown(last, { shiftKey: true });

    expect(flowStore.getState().lineSelection).toMatchObject({
      side: "new",
      startLine: 10,
      endLine: 11,
    });
    expect(
      container.querySelectorAll('td[data-side="left"][data-selected]').length,
    ).toBe(0);
  });

  it("a sign click inside a split selection comments on that side", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const first = sideCells(container, "right", "add");
    const numbers = container.querySelectorAll(
      'td[data-side="right"][data-line-number]',
    );
    const last = numbers[numbers.length - 1];
    if (!(last instanceof HTMLElement)) {
      throw new Error("expected a last cell");
    }
    fireEvent.mouseDown(first.number);
    fireEvent.mouseEnter(last);
    fireEvent.mouseUp(last);
    fireEvent.mouseDown(first.sign);
    fireEvent.mouseUp(first.sign);

    expect(openCommentComposer).toHaveBeenCalledTimes(1);
    expect(openCommentComposer.mock.calls[0]?.[0]).toMatchObject({
      side: "new",
      startLine: 10,
      endLine: 11,
    });
    expect(openCommentComposer.mock.calls[0]?.[0]).not.toHaveProperty(
      "startSide",
    );
  });

  it("anchors a left-side click on the old line", () => {
    const {
      view: { container },
      openCommentComposer,
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const left = sideCells(container, "left", "del");
    fireEvent.mouseDown(left.sign);
    fireEvent.mouseUp(left.sign);

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
      'td[data-side="right"] [data-comment-anchor]',
    );
    const last = rows[rows.length - 1];
    if (!(last instanceof HTMLElement)) {
      throw new Error("expected a last cell");
    }
    fireEvent.mouseDown(first.sign);
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
    fireEvent.mouseDown(left.sign);
    fireEvent.mouseEnter(right.sign);
    fireEvent.mouseUp(right.sign);

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
    fireEvent.mouseDown(left.sign);
    fireEvent.mouseUp(left.sign);

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
      'td[data-side="right"] [data-comment-anchor]',
    );
    const first = numbers[0];
    const last = numbers[numbers.length - 1];
    if (!first || !last) {
      throw new Error("expected right-side cells");
    }
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
    fireEvent.mouseUp(leftCtx.sign);

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
    fireEvent.mouseDown(left.sign);
    fireEvent.mouseEnter(right.sign);
    fireEvent.mouseUp(right.sign);
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
      "td [data-comment-anchor]",
    );
    const first = numbers[1];
    const last = numbers[numbers.length - 1];
    if (!first || !last) {
      throw new Error("expected number cells");
    }
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
    fireEvent.mouseDown(left.sign);
    fireEvent.mouseUp(left.sign);
    const row = container.querySelector('tr[data-placement="left"]');
    const cells = Array.from(row?.querySelectorAll("td") ?? []);
    const columns = container.querySelectorAll("colgroup col").length;

    expect(cells.map((cell) => cell.colSpan)).toEqual([columns - 3, 3]);
  });

  it("lays a side thread beside its side and a gap the other way", () => {
    const {
      view: { container },
    } = renderTable({ chunk: splitChunk(), view: "split" });
    const right = sideCells(container, "right", "add");
    fireEvent.mouseDown(right.sign);
    fireEvent.mouseUp(right.sign);
    const row = container.querySelector('tr[data-placement="right"]');
    const cells = Array.from(row?.querySelectorAll("td") ?? []);
    const columns = container.querySelectorAll("colgroup col").length;

    expect(cells.map((cell) => cell.colSpan)).toEqual([columns - 3, 3]);
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
      { posture: { composerDisabledReason: REASON } },
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

  it("drops a live drag when the view flips under it", () => {
    const { view, openCommentComposer, setProps } = renderTable({
      chunk: splitChunk(),
      view: "split",
    });
    const left = sideCells(view.container, "left", "del");
    fireEvent.mouseDown(left.number);
    expect(
      view.container.querySelectorAll("td[data-selected]").length,
    ).toBeGreaterThan(0);

    setProps({ view: "unified" });

    expect(view.container.querySelectorAll("[data-selected]").length).toBe(0);
    expect(
      view.container.querySelector("table")?.getAttribute("data-selecting"),
    ).toBeNull();
    expect(openCommentComposer).not.toHaveBeenCalled();
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

  it("reads unified for a chunk with no deletions", () => {
    const {
      view: { container },
    } = renderTable({ view: "split" });

    expect(container.querySelector("table")?.getAttribute("data-view")).toBe(
      "unified",
    );
    expect(container.querySelector('tbody[data-view="split"]')).toBeNull();
  });

  it("reads unified for a chunk with no additions", () => {
    const deletionsOnly = {
      ...chunk(),
      diff: [
        { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
        { kind: "del", content: "gone", oldLine: 10 },
      ],
    } as BriefChunk;
    const {
      view: { container },
    } = renderTable({ chunk: deletionsOnly, view: "split" });

    expect(container.querySelector("table")?.getAttribute("data-view")).toBe(
      "unified",
    );
    expect(container.querySelector('tbody[data-view="split"]')).toBeNull();
  });
});
