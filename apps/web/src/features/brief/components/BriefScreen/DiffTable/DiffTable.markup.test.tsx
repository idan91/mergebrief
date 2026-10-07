// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appI18n } from "../../../../../i18n/I18nProvider";
import {
  buildInlineThreads,
  splitInlineRows,
} from "@web/features/conversation/utils";
import type {
  ConversationThread,
  PrConversation,
} from "@web/features/conversation/types";
import type { ThreadComposerWiring } from "@web/features/conversation";
import {
  createReviewFlowStore,
  emptySessionPayload,
  ReviewFlowProvider,
  ReviewSessionProvider,
  type ReviewFlowState,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import { createCommentAnchor } from "@web/features/review/utils";
import type { AddressedReviewComment } from "../../../types";
import type { Brief, BriefChunk } from "../../../types";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { DiffTable } from ".";
import type { DiffTableProps } from "./types";
import {
  ReviewPostureProvider,
  type ReviewPosture,
} from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";

afterEach(cleanup);

function makeChunk(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 1 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [
      { kind: "hunk", content: "@@ -9,3 +9,3 @@" },
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "del", content: "old", oldLine: 10 },
      { kind: "add", content: "new", newLine: 10 },
      { kind: "note", content: "truncated" },
    ],
  } as BriefChunk;
}

function stripDiffRows(one: BriefChunk): BriefChunk {
  const { diff: _rows, ...rest } = one;
  return rest;
}

function makeConversation(): PrConversation {
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

function stubComposer(): ThreadComposerWiring {
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
  chunks: [stripDiffRows(makeChunk())],
  concernView: [],
};

interface RenderOverrides {
  chunk?: BriefChunk;
  addressedComments?: AddressedReviewComment[];
  flowState?: Partial<ReviewFlowState>;
  posture?: Partial<ReviewPosture>;
  session?: ReviewSessionPayload;
  comparisonView?: DiffTableProps["comparisonView"];
  view?: DiffTableProps["view"];
}

function renderTable(overrides: RenderOverrides = {}) {
  const rows =
    buildInlineThreads({
      conversation: makeConversation(),
      chunks: [makeChunk()],
      ownThreadIds: new Set(),
    }).get("c1") ?? [];
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
  if (overrides.flowState) {
    flowStore.setState(overrides.flowState);
  }
  const run = {
    chunkId: "c1",
    file: "src/a.ts",
    rowIndexes: [3],
    kind: "added" as const,
  };
  const props: DiffTableProps = {
    chunk: overrides.chunk ?? makeChunk(),
    comparisonView: overrides.comparisonView ?? {
      marks: new Map([[3, "added"]]),
      runs: [run],
      runByRow: new Map([[3, run]]),
    },
    comparisonSource: { kind: "last-review", delta: null },
    comparisonSkipReason: null,
    addressedComments: overrides.addressedComments ?? [],
    conversationThreadsByRow: splitInlineRows(rows).byRow,
    conversationComposer: stubComposer(),
    reviewCommentLabel: "review comment",
  };
  if (overrides.view !== undefined) {
    props.view = overrides.view;
  }
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(providerBrief)}
        session={overrides.session}
      >
        <ReviewFlowProvider store={flowStore}>
          <ReviewPostureProvider posture={makeReviewPosture(overrides.posture)}>
            <DiffTable {...props} />
          </ReviewPostureProvider>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );
}

// CSS module class names carry a per-stylesheet hash, so the suffix changes
// when a rule moves file without changing what it computes.
function stripStyleHashes(html: string): string {
  return html.replace(/_([A-Za-z][\w-]*)_[0-9a-z]{6}/g, "$1");
}

describe("DiffTable markup", () => {
  it("renders every row kind, a thread row and the revision gutter", () => {
    const view = renderTable();

    expect(stripStyleHashes(view.container.innerHTML)).toMatchSnapshot();
  });

  it("renders a disabled, selected row with a composer and comments", () => {
    const anchor = createCommentAnchor(
      "c1",
      "src/a.ts",
      makeChunk().diff ?? [],
      [3],
    );
    const addressed: AddressedReviewComment = {
      id: "a1",
      file: "src/a.ts",
      startLine: null,
      line: 10,
      originalStartLine: null,
      originalLine: null,
      author: "bob",
      body: "addressed already",
      inReplyToId: null,
      outdated: false,
    };
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
          body: "a draft on this row",
          status: "draft",
        },
      ],
    };
    const view = renderTable({
      addressedComments: [addressed],
      flowState: {
        composerAnchor: anchor,
        composerHost: anchor?.chunkId ?? null,
      },
      posture: { composerDisabledReason: "This revision is read-only." },
      session,
    });

    expect(stripStyleHashes(view.container.innerHTML)).toMatchSnapshot();
  });

  it("caps a split pair's rail where the run starts on the deleted side", () => {
    const run = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [2, 3],
      kind: "added" as const,
    };
    const { container } = renderTable({
      comparisonView: {
        marks: new Map([
          [2, "removed"],
          [3, "added"],
        ]),
        runs: [run],
        runByRow: new Map([
          [2, run],
          [3, run],
        ]),
      },
      view: "split",
    });
    const pair = container.querySelector('tbody[data-view="split"]');

    expect(pair?.querySelectorAll("[data-jump-target]")).toHaveLength(1);
  });

  it("paints a deletion's run on the edge and an added-only run on the seam", () => {
    const chunk = makeChunk();
    chunk.diff = [
      { kind: "hunk", content: "@@ -9,2 +9,3 @@" },
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "del", content: "old", oldLine: 10 },
      { kind: "add", content: "new", newLine: 10 },
      { kind: "add", content: "more", newLine: 11 },
    ];
    const withDeletion = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [2, 3],
      kind: "added" as const,
    };
    const additionsOnly = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [4],
      kind: "added" as const,
    };
    const { container } = renderTable({
      chunk,
      comparisonView: {
        marks: new Map([
          [2, "removed"],
          [3, "added"],
          [4, "added"],
        ]),
        runs: [withDeletion, additionsOnly],
        runByRow: new Map([
          [2, withDeletion],
          [3, withDeletion],
          [4, additionsOnly],
        ]),
      },
      view: "split",
    });

    const edge = container.querySelectorAll(
      "tbody td[data-gutter][data-rev]:not([data-placement])",
    );
    const seam = container.querySelectorAll(
      'tbody td[data-gutter][data-placement="seam"][data-rev]',
    );
    expect(edge).toHaveLength(1);
    expect(seam).toHaveLength(1);
    expect(edge[0]?.querySelector("[data-jump-target]")).not.toBeNull();
    expect(seam[0]?.querySelector("[data-jump-target]")).not.toBeNull();
    expect(
      edge[0]?.closest("tr")?.querySelector('td[data-line-old="10"]'),
    ).not.toBeNull();
    expect(
      seam[0]?.closest("tr")?.querySelector('td[data-line-new="11"]'),
    ).not.toBeNull();
  });
});
