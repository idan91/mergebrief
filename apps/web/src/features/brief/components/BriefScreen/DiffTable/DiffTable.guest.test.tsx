// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReviewFlowStore,
  emptySessionPayload,
  initialReviewFlowState,
  ReviewFlowProvider,
  ReviewSessionProvider,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import { type DiffView, DiffViews } from "@web/components/DiffRows/types";
import {
  type ThreadSide,
  ThreadSides,
  ThreadSubjectTypes,
} from "@web/features/conversation/types";
import {
  type DigestThreadRow,
  DigestRowKinds,
  ThreadPlacementKinds,
} from "@web/features/conversation/utils";
import { type DiffLine, DiffRowOrigins } from "@web/utils/diffTokens/types";
import { appI18n } from "../../../../../i18n/I18nProvider";
import type { ExpandedRows } from "../../../hooks/useExpandedRows";
import { type Brief, type BriefChunk, Concerns, Roles } from "../../../types";
import type { GuestRowsInput } from "../../../utils/guest-rows";
import type { FileLineOwners } from "../../../utils/lineOwner";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { DiffTable } from ".";

afterEach(cleanup);

function stubChunk(overrides: Partial<BriefChunk>): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 0, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    ...overrides,
  };
}

const FIRST = stubChunk({ id: "c1", addedRanges: [{ start: 10, end: 12 }] });
const SECOND = stubChunk({
  id: "c2",
  changeGroupId: "g2",
  addedRanges: [{ start: 40, end: 41 }],
});

/** The PR base to head rows of the file: both owners' lines inside hunks. */
const FILE_ROWS: DiffLine[] = [
  { kind: "hunk", content: "@@ -9,2 +9,5 @@" },
  { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
  { kind: "add", content: "b", newLine: 10 },
  { kind: "add", content: "c", newLine: 11 },
  { kind: "add", content: "d", newLine: 12 },
  { kind: "ctx", content: "e", oldLine: 10, newLine: 13 },
  { kind: "hunk", content: "@@ -36,2 +39,4 @@" },
  { kind: "ctx", content: "f", oldLine: 36, newLine: 39 },
  { kind: "add", content: "g", newLine: 40 },
  { kind: "add", content: "h", newLine: 41 },
  { kind: "ctx", content: "i", oldLine: 37, newLine: 42 },
];

/**
 * A span diff of the same file: its left side is a baseline, so the deleted
 * row's line means nothing at head, and its context rows carry baseline old
 * numbers beside head new numbers.
 */
function stubGuestRows(): DiffLine[] {
  const origin = DiffRowOrigins.GUEST;
  return [
    { kind: "hunk", content: "@@ -9,3 +9,4 @@", origin },
    { kind: "ctx", content: "a", oldLine: 9, newLine: 9, origin },
    { kind: "del", content: "gone", oldLine: 10, origin },
    { kind: "add", content: "b", newLine: 10, origin },
    { kind: "add", content: "c", newLine: 11, origin },
    { kind: "hunk", content: "@@ -30,1 +39,3 @@", origin },
    { kind: "ctx", content: "f", oldLine: 30, newLine: 39, origin },
    { kind: "add", content: "g", newLine: 40, origin },
    { kind: "add", content: "h", newLine: 41, origin },
  ];
}

function stubHost(): BriefChunk {
  return stubChunk({
    id: "raw:src/a.ts",
    changeGroupId: "raw-span",
    diff: stubGuestRows(),
  });
}

const OWNERS: FileLineOwners = {
  chunks: [FIRST, SECOND],
  owners: new Map([
    [
      "c1",
      {
        chunkId: "c1",
        groupName: "First",
        groupIndex: 1,
        groupCount: 2,
        remainder: false,
      },
    ],
    [
      "c2",
      {
        chunkId: "c2",
        groupName: "Second",
        groupIndex: 2,
        groupCount: 2,
        remainder: false,
      },
    ],
  ]),
};

const BRIEF: Brief = {
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
      title: "First",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
    {
      id: "g2",
      title: "Second",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [FIRST, SECOND],
  concernView: [],
};

function stubOwnerDraft(): ReviewSessionPayload {
  return {
    ...emptySessionPayload(),
    draftComments: [
      {
        id: "71",
        filePath: "src/a.ts",
        kind: "line",
        side: "new",
        startLine: 40,
        endLine: 40,
        body: "owner draft",
        status: "draft",
      },
    ],
  };
}

const THREAD_COMPOSER = {
  post: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
  onPosted: vi.fn(),
};

function stubOldSideDraft(): ReviewSessionPayload {
  return {
    ...emptySessionPayload(),
    draftComments: [
      {
        id: "72",
        filePath: "src/a.ts",
        kind: "line",
        side: "old",
        startLine: 9,
        endLine: 9,
        body: "old side draft",
        status: "draft",
      },
    ],
  };
}

function stubThread(
  side: ThreadSide,
  line: number,
  body: string,
): DigestThreadRow {
  return {
    kind: DigestRowKinds.THREAD,
    thread: {
      rootCommentId: line,
      path: "src/a.ts",
      line,
      side,
      subjectType: ThreadSubjectTypes.LINE,
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          commentId: line,
          author: { login: "alice", isBot: false },
          body,
          createdAt: "2026-07-01T10:00:00Z",
          url: `https://example.test/c/${String(line)}`,
        },
      ],
      hasMoreComments: false,
    },
    digestLine: body,
    placement: {
      kind: ThreadPlacementKinds.CHUNK,
      chunkId: "c1",
      rowId: `c1:${String(line)}`,
    },
    isOwn: false,
  };
}

/** An expansion a guest table must ignore: rows it never showed, framed by an owner. */
function stubForeignExpansion(): ExpandedRows {
  return {
    rows: [
      { kind: "ctx", content: "spliced", oldLine: 1, newLine: 1 },
      ...stubGuestRows(),
    ],
    baseIndexOf: [-1, ...stubGuestRows().map((_row, index) => index)],
    edges: [],
    expansionKey: "expanded",
  };
}

interface GuestTableOptions {
  session?: ReviewSessionPayload;
  /** Draft ids whose post-now call is in flight. */
  posting?: string[];
  guest?: Partial<GuestRowsInput>;
  view?: DiffView;
  fileThreads?: DigestThreadRow[];
  expansion?: ExpandedRows;
  lineOwners?: FileLineOwners;
}

function renderGuestTable({
  session,
  posting = [],
  guest: guestOverrides = {},
  view: diffView = DiffViews.UNIFIED,
  fileThreads,
  expansion,
  lineOwners,
}: GuestTableOptions = {}) {
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
      postingCommentIds: new Set(posting),
      postBlockedExternally: undefined,
      postComment: posting.length > 0 ? vi.fn() : undefined,
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
  const guest: GuestRowsInput = {
    file: "src/a.ts",
    fileRows: FILE_ROWS,
    owners: OWNERS,
    ...guestOverrides,
  };
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(BRIEF)}
        session={session}
      >
        <ReviewFlowProvider store={flowStore}>
          <DiffTable
            addressedComments={[]}
            chunk={stubHost()}
            comparisonSkipReason={null}
            comparisonSource={{ kind: "last-review", delta: null }}
            comparisonView={{ marks: new Map(), runs: [], runByRow: new Map() }}
            conversationComposer={THREAD_COMPOSER}
            expansion={expansion}
            fileThreads={fileThreads}
            guest={guest}
            lineOwners={lineOwners}
            reviewCommentLabel="review comment"
            view={diffView}
          />
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );

  return { view, flowStore, openCommentComposer };
}

function findRowByNewLine(container: HTMLElement, line: string): HTMLElement {
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>("tbody tr[data-line-kind]"),
  );
  const row = rows.find((candidate) => {
    const numbers = Array.from(
      candidate.querySelectorAll("[data-line-number]"),
    ).map((cell) => cell.textContent ?? "");
    return numbers[1] === line;
  });
  if (row === undefined) {
    throw new Error(`no row shows new line ${line}`);
  }
  return row;
}

function findDeletedRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    'tbody tr[data-line-kind="del"]',
  );
  if (row === null) {
    throw new Error("expected a deleted row");
  }
  return row;
}

describe("DiffTable guest rows", () => {
  it("anchors a comment on a guest row to the chunk that owns its line", () => {
    const { view, openCommentComposer } = renderGuestTable();
    const row = findRowByNewLine(view.container, "40");

    expect(row.hasAttribute("data-commentable")).toBe(true);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(openCommentComposer).toHaveBeenCalledTimes(1);
    expect(openCommentComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: "c2",
        file: "src/a.ts",
        side: "new",
        startLine: 40,
        endLine: 40,
        rowIds: [],
      }),
      "raw:src/a.ts",
    );
  });

  it("anchors rows of two owners to each owner in turn", () => {
    const { view, openCommentComposer } = renderGuestTable();

    fireEvent.keyDown(findRowByNewLine(view.container, "11"), { key: "Enter" });

    expect(openCommentComposer).toHaveBeenCalledWith(
      expect.objectContaining({ chunkId: "c1", startLine: 11 }),
      "raw:src/a.ts",
    );
  });

  it("shows an owner's draft under the guest row that shows its line", () => {
    const { view } = renderGuestTable({ session: stubOwnerDraft() });
    const row = findRowByNewLine(view.container, "40");
    const under = row.nextElementSibling;

    expect(screen.getByText("owner draft")).toBeTruthy();
    expect(under?.hasAttribute("data-under-row")).toBe(true);
    expect(under?.textContent).toContain("owner draft");
  });

  it("keeps a left-side row inert", () => {
    const { view, openCommentComposer } = renderGuestTable();
    const row = findDeletedRow(view.container);

    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.hasAttribute("data-commentable")).toBe(false);
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.mouseDown(row);
    fireEvent.mouseUp(row);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("keeps a right-side row the PR diff does not carry inert", () => {
    const { view } = renderGuestTable({
      guest: { fileRows: FILE_ROWS.filter((row) => row.newLine !== 39) },
    });
    const row = findRowByNewLine(view.container, "39");

    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.hasAttribute("data-commentable")).toBe(false);
  });

  it("ignores an expansion and frames no span: its rows are already foreign", () => {
    const { view } = renderGuestTable({
      expansion: stubForeignExpansion(),
      lineOwners: OWNERS,
    });

    expect(screen.queryByText("spliced")).toBeNull();
    expect(
      view.container.querySelectorAll("tbody tr[data-line-kind]"),
    ).toHaveLength(9);
    expect(
      view.container.querySelectorAll('[data-testid="sibling-span"]'),
    ).toHaveLength(0);
  });

  it("renders unified when split is asked for: its left side is a baseline", () => {
    const { view } = renderGuestTable({ view: DiffViews.SPLIT });

    expect(view.container.querySelector("[data-view='split']")).toBeNull();
    expect(findDeletedRow(view.container).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("shows a right-side thread on its row and drops a left-side one", () => {
    const { view } = renderGuestTable({
      fileThreads: [
        stubThread(ThreadSides.RIGHT, 40, "right thread"),
        stubThread(ThreadSides.LEFT, 10, "left thread"),
      ],
    });
    const row = findRowByNewLine(view.container, "40");

    expect(row.nextElementSibling?.textContent).toContain("right thread");
    expect(screen.queryByText("left thread")).toBeNull();
  });

  it("shows an owner's draft as posting while its post is in flight", () => {
    const { view } = renderGuestTable({
      session: stubOwnerDraft(),
      posting: ["71"],
    });
    const row = findRowByNewLine(view.container, "40");

    expect(row.nextElementSibling?.textContent).toContain(
      appI18n.t("review.comment.posting"),
    );
  });

  it("never shows an old-side draft: a guest old line is a baseline's", () => {
    renderGuestTable({ session: stubOldSideDraft() });

    expect(screen.queryByText("old side draft")).toBeNull();
  });

  it("comments a drag across a deleted row on its head lines only", () => {
    const { view, openCommentComposer } = renderGuestTable();
    const start = findRowByNewLine(view.container, "9");
    const sign = start.querySelector("[data-comment-anchor]");
    if (!(sign instanceof HTMLElement)) {
      throw new Error("expected a sign");
    }

    fireEvent.mouseDown(sign);
    fireEvent.mouseEnter(findDeletedRow(view.container));
    fireEvent.mouseUp(findRowByNewLine(view.container, "11"));

    expect(openCommentComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: "c1",
        side: "new",
        startLine: 9,
        endLine: 11,
        rowIds: [],
      }),
      "raw:src/a.ts",
    );
  });

  it("names the owner in a line selection so the link lands in Full", () => {
    const { view, flowStore } = renderGuestTable();
    const row = findRowByNewLine(view.container, "40");
    const number = row.querySelector("[data-select-anchor]");
    if (!(number instanceof HTMLElement)) {
      throw new Error("expected a number");
    }

    fireEvent.mouseDown(number);
    fireEvent.mouseUp(row);

    expect(flowStore.getState().lineSelection).toMatchObject({
      chunkId: "c2",
      side: "new",
      startLine: 40,
      endLine: 40,
      rowIds: [],
    });
  });
});
