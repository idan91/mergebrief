// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ThreadComposerWiring } from "@web/features/conversation";
import type { DigestThreadRow } from "@web/features/conversation/utils";
import {
  createReviewFlowStore,
  emptySessionPayload,
  ReviewFlowProvider,
  ReviewSessionProvider,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import { TokenPlanProvider } from "@web/hooks/useTokenPlan";
import { ChunkTokenStatuses, TokenizeModes } from "@web/utils/diffTokens/types";
import { appI18n } from "../../../../../i18n/I18nProvider";
import {
  type Brief,
  type BriefChunk,
  Concerns,
  type RevisionNarrative,
  Roles,
} from "../../../types";
import { FileRowsProvider } from "../../../hooks/useFileRows";
import type { FileRowsCache } from "../../../utils/fileRows";
import { buildLineOwnersByFile } from "../../../utils/lineOwner";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { type DeltaSpanStatus, DeltaSpanStatuses } from "../types";
import type { ChangesReviewWiring } from "./types";
import { ChangesOnlyView } from ".";
import { ReviewPostureProvider } from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";

const { requestSnippetTokens } = vi.hoisted(() => ({
  requestSnippetTokens: vi.fn(),
}));

vi.mock("@web/utils/diffTokens/client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    canTokenizeChunks: () => true,
    requestSnippetTokens,
    warmDiffTokenWorker: () => undefined,
  };
});

const PR = {
  repo: "acme/widgets",
  number: 7,
  title: "t",
  url: "https://example.com/pr/7",
  sha: "head1234",
  description: "",
};

const OWNER: BriefChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: Concerns.IMPLEMENTATION,
  role: Roles.CORE,
  loc: { added: 2, deleted: 0 },
  addedRanges: [
    { start: 11, end: 11 },
    { start: 40, end: 40 },
  ],
  removedRanges: [],
  riskSurface: [],
  summary: "Core chunk.",
  diff: [
    { kind: "hunk", content: "@@ -10,1 +10,2 @@" },
    { kind: "ctx", content: "const a = 1;", oldLine: 10, newLine: 10 },
    { kind: "add", content: "validate(a);", newLine: 11 },
    { kind: "hunk", content: "@@ -38,1 +39,2 @@" },
    { kind: "ctx", content: "const b = 2;", oldLine: 38, newLine: 39 },
    { kind: "add", content: "validate(b);", newLine: 40 },
  ],
};

const FULL_BRIEF: Brief = {
  artifactKind: "brief",
  pr: PR,
  summary: "Full brief summary.",
  index: 3,
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
  chunks: [OWNER],
  concernView: [],
};

const NARRATIVE: RevisionNarrative = {
  artifactKind: "revisionNarrative",
  pr: PR,
  prevHeadSha: "prev1234",
  headSha: "head1234",
  prevIndex: 2,
  headIndex: 3,
  generation: { provider: "anthropic", model: "m", effort: null },
  overview: "This revision adds a validation guard.",
  chunks: [
    {
      id: "rc1",
      briefChangeGroupId: "g1",
      file: "src/a.ts",
      addedRanges: [
        { start: 40, end: 40 },
        { start: 11, end: 11 },
      ],
      removedRanges: [{ start: 20, end: 21 }],
      summary: "Adds the validate(a) guard on the shared path.",
    },
  ],
};

/** Forty cards over one line, longer than the jsdom window renders. */
const LONG_NARRATIVE: RevisionNarrative = {
  ...NARRATIVE,
  chunks: Array.from({ length: 40 }, (_, index) => ({
    id: `rc${String(index + 1)}`,
    briefChangeGroupId: "g1",
    file: "src/a.ts",
    addedRanges: [{ start: 11, end: 11 }],
    removedRanges: [],
    summary: `Card ${String(index + 1)}.`,
  })),
};

const DELTA_CHUNK: BriefChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: Concerns.IMPLEMENTATION,
  role: Roles.CORE,
  loc: { added: 1, deleted: 1 },
  addedRanges: [],
  removedRanges: [],
  riskSurface: [],
  summary: "Delta chunk: adds the guard.",
  diff: [
    { kind: "hunk", content: "@@ -10,1 +10,2 @@" },
    { kind: "del", content: "check(a);", oldLine: 10 },
    { kind: "add", content: "validate(a);", newLine: 11 },
  ],
};

const DELTA: Brief = {
  schemaVersion: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  pr: PR,
  summary: "delta summary",
  changeGroups: [
    {
      id: "g1",
      title: "Guarded shared path",
      dominantCategory: "implementation",
      chunkIds: ["chunk-a"],
    },
  ],
  chunks: [DELTA_CHUNK],
} as unknown as Brief;

const FILE_ROWS_CACHE: FileRowsCache = {
  isEmpty: false,
  getFileRows: (path) => (path === "src/a.ts" ? OWNER.diff : undefined),
};

/** Previous head to head: lines 20 and 21 of the previous head went away. */
const SPAN_ROWS_CACHE: FileRowsCache = {
  isEmpty: false,
  getFileRows: (path) =>
    path === "src/a.ts"
      ? [
          { kind: "hunk", content: "@@ -19,3 +19,1 @@" },
          { kind: "ctx", content: "keep();", oldLine: 19, newLine: 19 },
          { kind: "del", content: "stale(a);", oldLine: 20 },
          { kind: "del", content: "stale(b);", oldLine: 21 },
        ]
      : undefined,
};

function stubThread(line: number): DigestThreadRow {
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

function stubComposer(): ThreadComposerWiring {
  return {
    post: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
    onPosted: vi.fn(),
  };
}

function stubFullDraft(): ReviewSessionPayload {
  return {
    ...emptySessionPayload(),
    draftComments: [
      {
        id: "91",
        filePath: "src/a.ts",
        kind: "line",
        side: "new",
        startLine: 11,
        endLine: 11,
        body: "full draft",
        status: "draft",
      },
    ],
  };
}

interface RenderOptions {
  compare?: "previous-brief" | "last-review";
  session?: ReviewSessionPayload;
  threads?: DigestThreadRow[];
  narrative?: RevisionNarrative;
  /** The flow store's composer host at render, as a pinned card would see it. */
  composerHost?: string;
  /** The last-review delta to render; the fixture with rows by default. */
  delta?: Brief;
  deltaSpan?: DeltaSpanStatus;
  /** The previous-brief span diff, the source of a card's removed lines. */
  narrativeSpanRows?: FileRowsCache;
  jumpToChunk?: (chunkId: string) => void;
}

function renderChanges(options: RenderOptions = {}) {
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
  if (options.composerHost !== undefined) {
    flowStore.setState({ composerHost: options.composerHost });
  }
  const model = buildBriefViewModel(FULL_BRIEF);
  const review: ChangesReviewWiring = {
    lineOwnersByFile: buildLineOwnersByFile(model, appI18n.t),
    lineThreadsByFile:
      options.threads === undefined
        ? undefined
        : new Map([["src/a.ts", options.threads]]),
    conversationComposer: stubComposer(),
  };
  const client = new QueryClient();
  function buildTree(next: RenderOptions) {
    const compare = next.compare ?? "previous-brief";
    return (
      <QueryClientProvider client={client}>
        <TokenPlanProvider
          briefKey="brief-1"
          chunkSizes={[{ file: "src/a.ts", rowCount: 3 }]}
        >
          <FileRowsProvider cache={FILE_ROWS_CACHE}>
            <ReviewSessionProvider
              briefId="test-brief"
              model={model}
              session={next.session}
            >
              <ReviewFlowProvider store={flowStore}>
                <ReviewPostureProvider posture={makeReviewPosture()}>
                  <ChangesOnlyView
                    brief={FULL_BRIEF}
                    compare={compare}
                    delta={
                      compare === "last-review" ? (next.delta ?? DELTA) : null
                    }
                    deltaSpan={next.deltaSpan}
                    marks={null}
                    model={model}
                    narrative={
                      compare === "previous-brief"
                        ? (next.narrative ?? NARRATIVE)
                        : null
                    }
                    jumpToChunk={next.jumpToChunk}
                    narrativeSpanRows={next.narrativeSpanRows}
                    review={review}
                    skipReason={null}
                  />
                </ReviewPostureProvider>
              </ReviewFlowProvider>
            </ReviewSessionProvider>
          </FileRowsProvider>
        </TokenPlanProvider>
      </QueryClientProvider>
    );
  }
  const view = render(buildTree(options));
  const rerender = (next: RenderOptions) => view.rerender(buildTree(next));

  return { view, rerender, flowStore, openCommentComposer };
}

function findGutterSign(row: HTMLElement): HTMLElement {
  const sign = row.querySelector("[data-comment-anchor]");
  if (!(sign instanceof HTMLElement)) {
    throw new Error("expected a gutter sign");
  }
  return sign;
}

function findCardRow(container: HTMLElement, content: string): HTMLElement {
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-line-origin="guest"][data-line-kind]',
    ),
  );
  const row = rows.find((candidate) =>
    candidate.textContent?.includes(content),
  );
  if (row === undefined) {
    throw new Error(`no card row shows ${content}`);
  }
  return row;
}

// CSS module class names carry a per-stylesheet hash.
function stripStyleHashes(html: string): string {
  return html.replace(/_([A-Za-z][\w-]*)_[0-9a-z]{6}/g, "$1");
}

// jsdom implements scrollTo as a loud not-implemented warning; the
// virtualizer's scroll anchoring calls it on measurement changes.
beforeAll(() => {
  vi.stubGlobal("scrollTo", vi.fn());
});

beforeEach(() => {
  requestSnippetTokens.mockReset();
  requestSnippetTokens.mockReturnValue({
    promise: Promise.resolve({ status: ChunkTokenStatuses.PLAIN }),
    cancel: () => undefined,
  });
});

afterEach(cleanup);

describe("Previous Brief narrative cards take comments", () => {
  it("anchors a comment on a card row to the owner with its exact row id", () => {
    const { view, openCommentComposer } = renderChanges();
    const row = findCardRow(view.container, "validate(a);");

    expect(row.hasAttribute("data-commentable")).toBe(true);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(openCommentComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: "chunk-a",
        file: "src/a.ts",
        side: "new",
        startLine: 11,
        endLine: 11,
        rowIds: ["chunk-a:2"],
      }),
      undefined,
      "narrative:src/a.ts#rc1",
    );
  });

  it("orders rows by line and notes the lines the card skips", () => {
    const { view } = renderChanges();
    const rows = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        "[data-index='0'] tbody tr[data-line-kind]",
      ),
    ).map((row) => [row.dataset["lineKind"], row.textContent]);

    expect(rows).toEqual([
      ["add", expect.stringContaining("validate(a);")],
      ["note", "28 lines not shown"],
      ["add", expect.stringContaining("validate(b);")],
    ]);
  });

  it("refuses a range dragged across the lines the card skips", () => {
    const { view, openCommentComposer } = renderChanges();
    const first = findCardRow(view.container, "validate(a);");
    const last = findCardRow(view.container, "validate(b);");

    fireEvent.mouseDown(findGutterSign(first));
    fireEvent.mouseEnter(last);
    fireEvent.mouseUp(last);

    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("keeps the card hosting the composer mounted outside the window", () => {
    // jsdom measures every card at zero, so all forty would fit the window.
    const offsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 200,
    });
    try {
      const hostId = "narrative:src/a.ts#rc40";
      const unpinned = renderChanges({ narrative: LONG_NARRATIVE });
      expect(
        unpinned.view.container.querySelector("[data-index='39']"),
      ).toBeNull();
      cleanup();

      const pinned = renderChanges({
        narrative: LONG_NARRATIVE,
        composerHost: hostId,
      });

      expect(
        pinned.view.container.querySelector("[data-index='39']"),
      ).not.toBeNull();
    } finally {
      if (offsetHeight !== undefined) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetHeight",
          offsetHeight,
        );
      }
    }
  });

  it("renders a draft made in Full on the card row that shows its line", () => {
    const { view } = renderChanges({ session: stubFullDraft() });
    const row = findCardRow(view.container, "validate(a);");

    expect(row.nextElementSibling?.textContent).toContain("full draft");
  });

  it("sits a live thread under the card row showing its line", () => {
    const { view } = renderChanges({ threads: [stubThread(11)] });
    const row = findCardRow(view.container, "validate(a);");

    expect(
      row.nextElementSibling?.getAttribute("data-conversation-thread"),
    ).toBe("9011");
    expect(screen.getByText("thread on 11")).toBeTruthy();
  });

  it("renders both line gutters like Full and keeps the removed-lines note", () => {
    const { view } = renderChanges();
    const row = findCardRow(view.container, "validate(a);");

    expect(row.querySelectorAll("[data-line-number]")).toHaveLength(2);
    expect(screen.getByText("−2 lines removed")).toBeTruthy();
  });

  it("matches the card markup snapshot", () => {
    const { view } = renderChanges();
    const card = view.container.querySelector("[data-index='0']");

    expect(stripStyleHashes(card?.innerHTML ?? "")).toMatchSnapshot();
  });
});

describe("Previous Brief narrative cards lead back to Full", () => {
  it("jumps to the owner chunk in Full from the card's Show in Full brief", () => {
    const jumpToChunk = vi.fn();
    renderChanges({ jumpToChunk });

    const jump = screen.getByRole("button", {
      name: "Show in Full brief, src/a.ts",
    });
    fireEvent.click(jump);

    expect(jumpToChunk).toHaveBeenCalledWith("chunk-a");
    expect(jump.getAttribute("aria-describedby")).toBe(
      "narrative:src/a.ts#rc1-summary",
    );
  });

  it("renders no Show in Full brief for a file no chunk of the brief touches", () => {
    const elsewhere: RevisionNarrative = {
      ...NARRATIVE,
      chunks: [{ ...NARRATIVE.chunks[0]!, file: "src/zzz.ts" }],
    };
    renderChanges({ jumpToChunk: vi.fn(), narrative: elsewhere });

    expect(
      screen.queryByRole("button", { name: /Show in Full brief/ }),
    ).toBeNull();
  });
});

describe("Your last review delta cards take comments", () => {
  it("anchors a comment on an added row to the owner of its head line", () => {
    const { view, openCommentComposer } = renderChanges({
      compare: "last-review",
    });
    const row = findCardRow(view.container, "validate(a);");

    expect(row.hasAttribute("data-commentable")).toBe(true);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(openCommentComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: "chunk-a",
        side: "new",
        startLine: 11,
        endLine: 11,
        rowIds: [],
      }),
      undefined,
      "delta:chunk-a",
    );
  });

  it("shows the lines this revision removed as inert rows from the span diff", () => {
    const { view } = renderChanges({ narrativeSpanRows: SPAN_ROWS_CACHE });

    const removed = view.container.querySelectorAll(
      'tr[data-line-kind="del"][aria-disabled="true"]',
    );
    expect(removed).toHaveLength(2);
    expect(removed[0]?.textContent).toContain("stale(a);");
    expect(screen.queryByText("−2 lines removed")).toBeNull();
  });

  it("keeps the removed-lines count while the span has no rows for the file", () => {
    const elsewhere: FileRowsCache = {
      isEmpty: false,
      getFileRows: () => undefined,
    };
    renderChanges({ narrativeSpanRows: elsewhere });

    expect(screen.getByText("−2 lines removed")).toBeTruthy();
  });

  it("keeps a deleted row inert with the removed-before-head reason", () => {
    const { view } = renderChanges({ compare: "last-review" });
    const row = findCardRow(view.container, "check(a);");
    const reasonId = row.getAttribute("aria-describedby") ?? "";

    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(reasonId)?.textContent).toBe(
      appI18n.t("brief.diff.guest.removedBeforeHead"),
    );
  });
});

describe("Your last review cards lead back to Full", () => {
  it("jumps to the full brief chunk on the delta card's file from its head", () => {
    const jumpToChunk = vi.fn();
    const ownDelta: Brief = {
      ...DELTA,
      chunks: [
        {
          ...DELTA_CHUNK,
          id: "delta-1",
          addedRanges: [{ start: 11, end: 11 }],
        },
      ],
    };
    renderChanges({ compare: "last-review", delta: ownDelta, jumpToChunk });

    fireEvent.click(
      screen.getByRole("button", { name: "Show in Full brief, src/a.ts" }),
    );

    expect(jumpToChunk).toHaveBeenCalledWith("chunk-a");
  });
});

describe("Your last review cards show code", () => {
  const { diff: _rows, ...deltaCore } = DELTA_CHUNK;
  const rowless: Brief = { ...DELTA, chunks: [deltaCore] };

  it("shows the summary alone while the span diff loads", () => {
    const { view } = renderChanges({
      compare: "last-review",
      delta: rowless,
      deltaSpan: DeltaSpanStatuses.LOADING,
    });

    expect(screen.getByText("Delta chunk: adds the guard.")).toBeTruthy();
    expect(view.container.querySelector("[data-line-kind]")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("keeps the summary and says the diff is not viewable when it fails", () => {
    renderChanges({
      compare: "last-review",
      delta: rowless,
      deltaSpan: DeltaSpanStatuses.ERROR,
    });

    expect(screen.getByText("Delta chunk: adds the guard.")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe(
      appI18n.t("brief.diff.rawUnavailable"),
    );
  });

  it("shows the summary first and the rows once the span diff lands", () => {
    const { view, rerender } = renderChanges({
      compare: "last-review",
      delta: rowless,
      deltaSpan: DeltaSpanStatuses.LOADING,
    });
    expect(view.container.querySelector("[data-line-kind]")).toBeNull();

    rerender({ compare: "last-review", deltaSpan: DeltaSpanStatuses.READY });

    const deleted = view.container.querySelector('tr[data-line-kind="del"]');
    const added = view.container.querySelector('tr[data-line-kind="add"]');
    expect(screen.getByText("Delta chunk: adds the guard.")).toBeTruthy();
    expect(deleted?.getAttribute("aria-disabled")).toBe("true");
    expect(added?.hasAttribute("data-commentable")).toBe(true);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("Changes Only diff tokenization", () => {
  it("tokenizes a narrative card's rows as one side", () => {
    renderChanges();

    expect(requestSnippetTokens).toHaveBeenCalledTimes(1);
    expect(requestSnippetTokens.mock.calls[0]?.[0]).toMatchObject({
      filePath: "src/a.ts",
      mode: TokenizeModes.STANDALONE,
    });
  });

  it("reconstructs hunk sides for a delta chunk carrying del rows", () => {
    renderChanges({ compare: "last-review" });

    expect(requestSnippetTokens).toHaveBeenCalledTimes(1);
    expect(requestSnippetTokens.mock.calls[0]?.[0]).toMatchObject({
      filePath: "src/a.ts",
      mode: TokenizeModes.HUNK,
    });
  });
});
