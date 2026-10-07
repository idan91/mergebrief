// @vitest-environment jsdom
import { appI18n } from "../../../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThreadComposerWiring } from "@web/features/conversation";
import {
  ThreadPlacementKinds,
  type DigestThreadRow,
  DigestRowKinds,
} from "@web/features/conversation/utils";
import {
  createReviewFlowStore,
  emptySessionPayload,
  ReviewFlowProvider,
  ReviewSessionProvider,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import {
  createExpansionStore,
  ExpansionProvider,
} from "../../../../../hooks/useExpansion";
import type { ComparisonOverlayState } from "../../../../../comparison/comparisonOverlay";
import type {
  AddressedReviewComment,
  Brief,
  BriefChunk,
} from "../../../../../types";
import { buildBriefViewModel } from "../../../../../utils/viewModel";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../../../readingPosition";
import { ChunkCard, type ChunkCardProps } from "..";
import { CommentAnchorKinds } from "types/comments";
import { ReviewCommentStatuses } from "@web/features/review/utils";
import { ThreadSubjectTypes } from "@web/features/conversation/types";
import { ReviewPostureProvider } from "../../../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../../../utils/review-posture";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
});

const chunk: BriefChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: "implementation",
  role: "core",
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 11, end: 11 }],
  removedRanges: [],
  riskSurface: [],
  diff: [{ kind: "add", content: "validate(a);", newLine: 11 }],
};

const brief: Brief = {
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
  chunks: [chunk],
  concernView: [],
};

const comparison: ComparisonOverlayState = {
  compare: "off",
  marks: null,
  source: { kind: "last-review", delta: null },
  skipReason: null,
  available: false,
  runCount: 0,
};

function stubComposer(): ThreadComposerWiring {
  return {
    post: vi.fn(async () => ({ kind: "posted" as const, commentId: 1 })),
    onPosted: vi.fn(),
  };
}

function makeFileDraftSession(): ReviewSessionPayload {
  return {
    ...emptySessionPayload(),
    draftComments: [
      {
        id: "51",
        kind: CommentAnchorKinds.FILE,
        filePath: chunk.file,
        body: "saved file note",
        status: ReviewCommentStatuses.DRAFT,
      },
    ],
  };
}

function makeInboundFileRow(): DigestThreadRow {
  return {
    kind: DigestRowKinds.THREAD,
    thread: {
      rootCommentId: 9001,
      path: chunk.file,
      subjectType: ThreadSubjectTypes.FILE,
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          commentId: 9001,
          author: { login: "alice", isBot: false },
          body: "inbound file thread",
          createdAt: "2026-07-01T10:00:00Z",
          url: "https://example.test/c/9001",
        },
      ],
      hasMoreComments: false,
    },
    digestLine: "inbound file thread",
    placement: { kind: ThreadPlacementKinds.FILE_HEADER, chunkId: chunk.id },
    isOwn: false,
  };
}

interface RenderOptions {
  open?: boolean;
  session?: ReviewSessionPayload;
  composerDisabledReason?: string;
  conversationRows?: ChunkCardProps["conversationRows"];
  conversationComposer?: ThreadComposerWiring;
  addressedReviewComments?: AddressedReviewComment[];
}

function renderCard(options: RenderOptions = {}) {
  const toggleChunk = vi.fn();
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(() => Promise.resolve(true)),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
      reanchorComment: vi.fn(),
    },
    appI18n.t,
  );
  const props: ChunkCardProps = {
    chunk,
    comparison,
    open: options.open ?? true,
    addressedReviewComments: options.addressedReviewComments ?? [],
    toggleChunk,
    markReviewed: vi.fn(),
    conversationRows: options.conversationRows,
    conversationComposer: options.conversationComposer,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(brief)}
        session={options.session}
      >
        <ReviewFlowProvider store={flowStore}>
          <ExpansionProvider store={createExpansionStore()}>
            <ReviewPostureProvider
              posture={makeReviewPosture({
                composerDisabledReason: options.composerDisabledReason,
              })}
            >
              <ReadingPositionProvider store={createReadingPositionStore()}>
                <ChunkCard {...props} />
              </ReadingPositionProvider>
            </ReviewPostureProvider>
          </ExpansionProvider>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );
  return { flowStore, toggleChunk };
}

describe("FileCommentBand", () => {
  it("names the header control with the file path", () => {
    renderCard({ open: false });
    expect(
      screen.getByRole("button", { name: "Add a comment on src/a.ts" }),
    ).toBeTruthy();
  });

  it("shows Comment on file in the callout, not the path", () => {
    renderCard({ open: false });
    const control = screen.getByRole("button", {
      name: "Add a comment on src/a.ts",
    });
    // Focus shows the callout at once; a pointer earns it after a rest.
    fireEvent.focus(control);
    expect(screen.getByRole("tooltip").textContent).toBe("Comment on file");
  });

  it("opens a file composer without a line count", () => {
    renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: "Add a comment on src/a.ts" }),
    );
    const band = screen.getByTestId("file-comment-band");
    expect(within(band).getByText("Add comment on file")).toBeTruthy();
    expect(within(band).queryByText(/line/)).toBeNull();
  });

  it("closes the file composer when the header control is pressed again", () => {
    renderCard();
    const control = screen.getByRole("button", {
      name: "Add a comment on src/a.ts",
    });
    fireEvent.click(control);
    expect(screen.getByTestId("file-comment-band")).toBeTruthy();
    fireEvent.click(control);
    expect(screen.queryByTestId("file-comment-band")).toBeNull();
  });

  it("expands a collapsed chunk when compose is requested", () => {
    const { toggleChunk } = renderCard({ open: false });
    fireEvent.click(
      screen.getByRole("button", { name: "Add a comment on src/a.ts" }),
    );
    expect(toggleChunk).toHaveBeenCalledWith(chunk.id);
    expect(screen.queryByTestId("file-comment-band")).toBeNull();
  });

  it("labels a saved file draft as a comment on file", () => {
    renderCard({ session: makeFileDraftSession() });
    const band = screen.getByTestId("file-comment-band");
    expect(
      within(band).getByRole("button", { name: "Comment on file" }),
    ).toBeTruthy();
    expect(within(band).getByText("saved file note")).toBeTruthy();
    expect(within(band).queryByText(/src\/a\.ts:/)).toBeNull();
  });

  it("collapses the band without collapsing the chunk", () => {
    const { toggleChunk } = renderCard({ session: makeFileDraftSession() });
    fireEvent.click(screen.getByRole("button", { name: "Comment on file" }));
    expect(toggleChunk).not.toHaveBeenCalled();
    expect(screen.queryByText("saved file note")).toBeNull();
    const title = screen.getByRole("button", { name: "Comment on file" });
    expect(title.getAttribute("aria-expanded")).toBe("false");
    const twist = title.querySelector('[data-icon="caret-down"]');
    expect(twist?.getAttribute("data-rotation")).toBe("270");
  });

  it("announces why compose is blocked instead of no-op", () => {
    vi.useFakeTimers();
    const { flowStore } = renderCard({
      composerDisabledReason: "Historical revision.",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add a comment on src/a.ts" }),
    );
    expect(screen.queryByTestId("file-comment-band")).toBeNull();
    vi.advanceTimersByTime(50);
    expect(flowStore.getState().toast).toBe("Historical revision.");
  });

  it("keeps the composer on the header that opened it", () => {
    const second: BriefChunk = { ...chunk, id: "chunk-b" };
    const toggleChunk = vi.fn();
    const flowStore = createReviewFlowStore(
      {
        saveComment: vi.fn(() => Promise.resolve(true)),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
        toggleComment: vi.fn(),
        reanchorComment: vi.fn(),
      },
      appI18n.t,
    );
    const splitBrief: Brief = { ...brief, chunks: [chunk, second] };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReviewSessionProvider
          briefId="test-brief"
          model={buildBriefViewModel(splitBrief)}
        >
          <ReviewFlowProvider store={flowStore}>
            <ExpansionProvider store={createExpansionStore()}>
              <ReviewPostureProvider posture={makeReviewPosture()}>
                <ReadingPositionProvider store={createReadingPositionStore()}>
                  <ChunkCard
                    addressedReviewComments={[]}
                    chunk={chunk}
                    comparison={comparison}
                    markReviewed={vi.fn()}
                    open
                    toggleChunk={toggleChunk}
                  />
                  <ChunkCard
                    addressedReviewComments={[]}
                    chunk={second}
                    comparison={comparison}
                    markReviewed={vi.fn()}
                    open
                    toggleChunk={toggleChunk}
                  />
                </ReadingPositionProvider>
              </ReviewPostureProvider>
            </ExpansionProvider>
          </ReviewFlowProvider>
        </ReviewSessionProvider>
      </QueryClientProvider>,
    );
    const controls = screen.getAllByRole("button", {
      name: "Add a comment on src/a.ts",
    });
    const firstControl = controls[0];
    if (firstControl === undefined) {
      throw new Error("expected two controls");
    }
    fireEvent.click(firstControl);
    expect(screen.getAllByText("Add comment on file")).toHaveLength(1);
  });

  it("renders an inbound FILE thread in the band", () => {
    renderCard({
      conversationRows: [makeInboundFileRow()],
      conversationComposer: stubComposer(),
    });
    const band = screen.getByTestId("file-comment-band");
    expect(within(band).getByText("inbound file thread")).toBeTruthy();
    expect(screen.queryByText("inbound file thread")).toBeTruthy();
  });

  it("shows a path-only GitHub comment in the summary without conversation", () => {
    renderCard({
      addressedReviewComments: [
        {
          id: "gh-file",
          file: chunk.file,
          startLine: null,
          line: null,
          originalStartLine: null,
          originalLine: null,
          author: "alice",
          body: "github file comment",
          inReplyToId: null,
          outdated: false,
        },
      ],
    });
    expect(screen.getByText("github file comment")).toBeTruthy();
  });

  it("keeps a path-only GitHub comment out of the summary on the PR path", () => {
    renderCard({
      addressedReviewComments: [
        {
          id: "gh-file",
          file: chunk.file,
          startLine: null,
          line: null,
          originalStartLine: null,
          originalLine: null,
          author: "alice",
          body: "github file comment",
          inReplyToId: null,
          outdated: false,
        },
      ],
      conversationComposer: stubComposer(),
    });
    expect(screen.queryByText("github file comment")).toBeNull();
  });
});
