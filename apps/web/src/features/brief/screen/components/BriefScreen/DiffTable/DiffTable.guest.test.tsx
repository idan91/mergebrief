// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Concerns, Roles } from "brief-core/types";
import {
  createReviewFlowStore,
  emptySessionPayload,
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
import { appI18n } from "../../../../../../i18n/I18nProvider";
import type { ExpandedRows } from "../../../../model/expansion/useExpandedRows";
import { type Brief, type BriefChunk } from "../../../../model/types";
import type { GuestRowsInput } from "../../../utils/guest-rows";
import type { FileLineOwners } from "../../../../model/utils/lineOwner";
import { buildBriefViewModel } from "../../../../model/utils/viewModel";
import { DiffTable } from ".";
import { ReviewPostureProvider } from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";

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
  composerDisabledReason?: string;
  guest?: Partial<GuestRowsInput>;
  view?: DiffView;
  fileThreads?: DigestThreadRow[];
  expansion?: ExpandedRows;
  lineOwners?: FileLineOwners;
}

function renderGuestTable({
  session,
  posting = [],
  composerDisabledReason,
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
    appI18n.t,
  );
  const openCommentComposer = vi.fn(flowStore.getState().actions.openComposer);
  flowStore.setState({
    actions: {
      ...flowStore.getState().actions,
      openComposer: openCommentComposer,
    },
  });
  const posture = makeReviewPosture({
    composerDisabledReason,
    postingCommentIds: new Set(posting),
    postComment: posting.length > 0 ? vi.fn() : undefined,
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
          <ReviewPostureProvider posture={posture}>
            <DiffTable
              addressedComments={[]}
              chunk={stubHost()}
              comparisonSkipReason={null}
              comparisonSource={{ kind: "last-review", delta: null }}
              comparisonView={{
                marks: new Map(),
                runs: [],
                runByRow: new Map(),
              }}
              conversationComposer={THREAD_COMPOSER}
              expansion={expansion}
              fileThreads={fileThreads}
              guest={guest}
              lineOwners={lineOwners}
              reviewCommentLabel="review comment"
              view={diffView}
            />
          </ReviewPostureProvider>
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

function findNumber(row: HTMLElement): HTMLElement {
  const number = row.querySelector("[data-select-anchor]");
  if (!(number instanceof HTMLElement)) {
    throw new Error("expected a line number");
  }
  return number;
}

function findCodeCell(row: HTMLElement): HTMLElement {
  const cell = row.querySelector("td:last-child");
  if (!(cell instanceof HTMLElement)) {
    throw new Error("expected a code cell");
  }
  return cell;
}

function findReasonRow(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="reason-row"]');
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
      undefined,
      "raw:src/a.ts",
    );
  });

  it("anchors rows of two owners to each owner in turn", () => {
    const { view, openCommentComposer } = renderGuestTable();

    fireEvent.keyDown(findRowByNewLine(view.container, "11"), { key: "Enter" });

    expect(openCommentComposer).toHaveBeenCalledWith(
      expect.objectContaining({ chunkId: "c1", startLine: 11 }),
      undefined,
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
      undefined,
      "raw:src/a.ts",
    );
  });

  it("describes an inert row by its reason before any key is pressed", () => {
    const { view } = renderGuestTable();
    const row = findDeletedRow(view.container);
    const reasonId = row.getAttribute("aria-describedby") ?? "";

    expect(document.getElementById(reasonId)?.textContent).toBe(
      appI18n.t("brief.diff.guest.removedBeforeHead"),
    );
    expect(
      view.container.querySelector('[data-testid="reason-row"]'),
    ).toBeNull();
  });

  it("opens the reason row on Enter, lands on Close, and Escape returns", () => {
    const { view } = renderGuestTable();
    const row = findDeletedRow(view.container);
    row.focus();

    fireEvent.keyDown(row, { key: "Enter" });

    const reasonRow = view.container.querySelector(
      '[data-testid="reason-row"]',
    );
    expect(reasonRow).not.toBeNull();
    expect(row.nextElementSibling?.contains(reasonRow)).toBe(true);
    expect(reasonRow?.textContent).toContain(
      appI18n.t("brief.diff.guest.removedBeforeHead"),
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Escape" });

    expect(
      view.container.querySelector('[data-testid="reason-row"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("toggles the reason row on Space and on click, and Close returns", () => {
    const { view } = renderGuestTable();
    const row = findDeletedRow(view.container);

    fireEvent.keyDown(row, { key: " " });
    expect(
      view.container.querySelector('[data-testid="reason-row"]'),
    ).not.toBeNull();
    fireEvent.keyDown(row, { key: " " });
    expect(
      view.container.querySelector('[data-testid="reason-row"]'),
    ).toBeNull();

    fireEvent.mouseDown(findNumber(row));
    fireEvent.mouseUp(findNumber(row));
    expect(
      view.container.querySelector('[data-testid="reason-row"]'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      view.container.querySelector('[data-testid="reason-row"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("keeps one reason row open at a time", () => {
    const { view } = renderGuestTable({
      guest: { fileRows: FILE_ROWS.filter((row) => row.newLine !== 39) },
    });
    const deleted = findDeletedRow(view.container);
    const missing = findRowByNewLine(view.container, "39");

    fireEvent.keyDown(deleted, { key: "Enter" });
    fireEvent.keyDown(missing, { key: "Enter" });

    const open = view.container.querySelectorAll('[data-testid="reason-row"]');
    expect(open).toHaveLength(1);
    expect(missing.nextElementSibling?.contains(open[0] ?? null)).toBe(true);
    expect(open[0]?.textContent).toContain(
      appI18n.t("brief.diff.guest.notInPrDiff"),
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

  it("describes Close by the reason it closes", () => {
    const { view } = renderGuestTable();
    const row = findDeletedRow(view.container);

    fireEvent.keyDown(row, { key: "Enter" });

    const close = screen.getByRole("button", { name: "Close" });
    const textId = close.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(textId)?.textContent).toBe(
      appI18n.t("brief.diff.guest.removedBeforeHead"),
    );
  });

  it("closes the reason row on Escape from the row itself", () => {
    const { view } = renderGuestTable();
    const row = findDeletedRow(view.container);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(findReasonRow(view.container)).not.toBeNull();

    row.focus();
    fireEvent.keyDown(row, { key: "Escape" });

    expect(findReasonRow(view.container)).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("leaves the code text to text selection: a release there never toggles", () => {
    const { view } = renderGuestTable();
    const row = findDeletedRow(view.container);

    fireEvent.mouseDown(findCodeCell(row));
    fireEvent.mouseUp(findCodeCell(row));

    expect(findReasonRow(view.container)).toBeNull();
  });

  it("ignores a secondary button release on the line number", () => {
    const { view } = renderGuestTable();
    const row = findDeletedRow(view.container);

    fireEvent.mouseUp(findNumber(row), { button: 2 });

    expect(findReasonRow(view.container)).toBeNull();
  });

  it("ignores a release that ends a text selection over the table", () => {
    const { view } = renderGuestTable();
    const row = findDeletedRow(view.container);
    const selection = window.getSelection();
    if (selection === null) {
      throw new Error("expected a selection api");
    }
    const range = document.createRange();
    range.selectNodeContents(findCodeCell(row));
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseUp(findNumber(row));

    expect(findReasonRow(view.container)).toBeNull();
    selection.removeAllRanges();
  });

  it("finishes a number drag released on an inert row as a selection", () => {
    const { view, flowStore } = renderGuestTable();
    const start = findRowByNewLine(view.container, "11");

    fireEvent.mouseDown(findNumber(start));
    fireEvent.mouseUp(findNumber(findDeletedRow(view.container)));

    expect(findReasonRow(view.container)).toBeNull();
    expect(flowStore.getState().lineSelection).toMatchObject({
      chunkId: "c1",
      startLine: 10,
      endLine: 11,
    });
  });

  it("starts a number drag on an inert row and keeps the head lines", () => {
    const { view, flowStore } = renderGuestTable();

    fireEvent.mouseDown(findNumber(findDeletedRow(view.container)));
    fireEvent.mouseUp(findNumber(findRowByNewLine(view.container, "11")));

    expect(findReasonRow(view.container)).toBeNull();
    expect(flowStore.getState().lineSelection).toMatchObject({
      chunkId: "c1",
      startLine: 10,
      endLine: 11,
    });
  });

  it("extends a selection to an inert row with Shift and Space", () => {
    const { view, flowStore } = renderGuestTable();
    const number = findNumber(findRowByNewLine(view.container, "11"));
    fireEvent.mouseDown(number);
    fireEvent.mouseUp(number);
    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 11,
      endLine: 11,
    });

    fireEvent.keyDown(findDeletedRow(view.container), {
      key: " ",
      shiftKey: true,
    });

    expect(findReasonRow(view.container)).toBeNull();
    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 10,
      endLine: 11,
    });
  });

  it("extends a selection with a Shift click on an inert row's numbers", () => {
    const { view, flowStore } = renderGuestTable();
    const number = findNumber(findRowByNewLine(view.container, "11"));
    fireEvent.mouseDown(number);
    fireEvent.mouseUp(number);

    const inertNumber = findNumber(findDeletedRow(view.container));
    fireEvent.mouseDown(inertNumber, { shiftKey: true });
    fireEvent.mouseUp(inertNumber, { shiftKey: true });

    expect(findReasonRow(view.container)).toBeNull();
    expect(flowStore.getState().lineSelection).toMatchObject({
      startLine: 10,
      endLine: 11,
    });
  });

  it("clears a live selection on Escape from an inert row", () => {
    const { view, flowStore } = renderGuestTable();
    const number = findNumber(findRowByNewLine(view.container, "11"));
    fireEvent.mouseDown(number);
    fireEvent.mouseUp(number);
    expect(flowStore.getState().lineSelection).not.toBeNull();

    fireEvent.keyDown(findDeletedRow(view.container), { key: "Escape" });

    expect(flowStore.getState().lineSelection).toBeNull();
  });

  it("returns focus to the row when a click closes the reason row", () => {
    const { view } = renderGuestTable();
    const row = findDeletedRow(view.container);
    fireEvent.mouseDown(findNumber(row));
    fireEvent.mouseUp(findNumber(row));
    expect(findReasonRow(view.container)).not.toBeNull();

    fireEvent.mouseDown(findNumber(row));
    fireEvent.mouseUp(findNumber(row));

    expect(findReasonRow(view.container)).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("describes an inert row by the posture and its reason when read-only", () => {
    const { view } = renderGuestTable({
      composerDisabledReason: "Frozen for this revision",
    });
    const row = findDeletedRow(view.container);
    const ids = (row.getAttribute("aria-describedby") ?? "").split(" ");
    const texts = ids.map((id) => document.getElementById(id)?.textContent);

    expect(texts).toEqual([
      "Frozen for this revision",
      appI18n.t("brief.diff.guest.removedBeforeHead"),
    ]);
  });
});
