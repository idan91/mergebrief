// @vitest-environment jsdom
import {
  CommentAnchorKinds,
  DraftCommentStatuses,
  ThreadSubjectTypes,
} from "types";
import { appI18n } from "../../../../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MentionCandidateKinds } from "@web/components/MarkdownTextarea/types";
import type { ThreadComposerWiring } from "@web/features/conversation";
import {
  ThreadPlacementKinds,
  type DigestThreadRow,
  DigestRowKinds,
} from "@web/features/conversation/utils";
import {
  ComposerStateKinds,
  createReviewFlowStore,
  emptySessionPayload,
  ReviewFlowProvider,
  ReviewSessionProvider,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import {
  createExpansionStore,
  ExpansionProvider,
} from "../../../../../../model/expansion/useExpansion";
import type { ComparisonOverlayState } from "../../../../../../model/comparison/comparison-overlay";
import type {
  AddressedReviewComment,
  Brief,
  BriefChunk,
} from "../../../../../../model/types";
import { buildBriefViewModel } from "../../../../../../model/utils/view-model";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../../../reading/reading-position";
import { ChunkCard, type ChunkCardProps } from "..";
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

function stubMentionComposer(): ThreadComposerWiring {
  return {
    ...stubComposer(),
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

function makeFileDraftSession(): ReviewSessionPayload {
  return {
    ...emptySessionPayload(),
    draftComments: [
      {
        id: "51",
        kind: CommentAnchorKinds.FILE,
        filePath: chunk.file,
        body: "saved file note",
        status: DraftCommentStatuses.DRAFT,
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
  saveComment?: () => Promise<boolean>;
}

function renderCard(options: RenderOptions = {}) {
  const toggleChunk = vi.fn();
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(options.saveComment ?? (() => Promise.resolve(true))),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
      reanchorComment: vi.fn(),
    },
    appI18n.t,
  );
  const props: ChunkCardProps = {
    actionsOpen: false,
    openActions: vi.fn(),
    closeActions: vi.fn(),
    chunk,
    comparison,
    open: options.open ?? true,
    addressedReviewComments: options.addressedReviewComments ?? [],
    toggleChunk,
    markReviewed: vi.fn(),
    conversationRows: options.conversationRows,
    conversationComposer: options.conversationComposer,
  };
  const client = new QueryClient();
  const buildCardTree = (
    cardProps: ChunkCardProps,
    cardKey: string | undefined,
  ) => (
    <QueryClientProvider client={client}>
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
                {cardKey === undefined ? null : (
                  <ChunkCard key={cardKey} {...cardProps} />
                )}
              </ReadingPositionProvider>
            </ReviewPostureProvider>
          </ExpansionProvider>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>
  );
  const view = render(buildCardTree(props, "first"));
  const rerenderCard = (patch: Partial<ChunkCardProps>, cardKey = "first") =>
    view.rerender(buildCardTree({ ...props, ...patch }, cardKey));
  const unmountCard = () => view.rerender(buildCardTree(props, undefined));
  return { flowStore, toggleChunk, rerenderCard, unmountCard };
}

/** A host's release settles a microtask after its unmount effects flush. */
async function flushHostRelease(): Promise<void> {
  await act(async () => undefined);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function clickFileCommentControl(): void {
  fireEvent.click(
    screen.getByRole("button", { name: "Add a comment on src/a.ts" }),
  );
}

describe("FileCommentBand", () => {
  it("shows Comment on file in the callout, not the path", () => {
    renderCard({ open: false });
    const control = screen.getByRole("button", {
      name: "Add a comment on src/a.ts",
    });
    // Keyboard focus shows the callout at once; a pointer earns it after a rest.
    vi.spyOn(control, "matches").mockReturnValue(true);
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
                    actionsOpen={false}
                    addressedReviewComments={[]}
                    closeActions={vi.fn()}
                    openActions={vi.fn()}
                    chunk={chunk}
                    comparison={comparison}
                    markReviewed={vi.fn()}
                    open
                    toggleChunk={toggleChunk}
                  />
                  <ChunkCard
                    actionsOpen={false}
                    addressedReviewComments={[]}
                    closeActions={vi.fn()}
                    openActions={vi.fn()}
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

  it("keeps the file composer open when its card remounts", async () => {
    const { flowStore, rerenderCard } = renderCard();
    clickFileCommentControl();

    rerenderCard({}, "remounted");
    await flushHostRelease();

    expect(screen.getByLabelText("Comment")).toBeTruthy();
    expect(flowStore.getState().composer.kind).toBe(ComposerStateKinds.OPEN);
  });

  it("closes the file composer when its card unmounts", async () => {
    const { flowStore, unmountCard } = renderCard();
    clickFileCommentControl();

    unmountCard();
    await flushHostRelease();

    expect(flowStore.getState().composer.kind).toBe(ComposerStateKinds.CLOSED);
  });

  it("closes the file composer when its chunk collapses", async () => {
    const { flowStore, rerenderCard } = renderCard();
    clickFileCommentControl();

    rerenderCard({ open: false });
    await flushHostRelease();

    expect(flowStore.getState().composer.kind).toBe(ComposerStateKinds.CLOSED);
  });

  it("closes the file composer only once its save lands", async () => {
    let land: (saved: boolean) => void = () => undefined;
    const { flowStore } = renderCard({
      saveComment: () =>
        new Promise<boolean>((resolve) => {
          land = resolve;
        }),
    });
    clickFileCommentControl();
    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "file note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
    await act(async () => {
      land(false);
    });
    expect(screen.getByLabelText<HTMLTextAreaElement>("Comment").value).toBe(
      "file note",
    );
    expect(flowStore.getState().composer.kind).toBe(ComposerStateKinds.OPEN);
  });

  it("shows no saving state under a header whose composer is not saving", () => {
    const { flowStore } = renderCard();
    act(() => {
      flowStore.setState({
        composer: {
          kind: ComposerStateKinds.SAVING,
          anchor: { kind: CommentAnchorKinds.FILE, file: chunk.file },
          host: "chunk-b",
          token: 1,
        },
      });
    });

    expect(screen.queryByTestId("file-comment-band")).toBeNull();
    expect(screen.queryByText("Saving…")).toBeNull();
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
          author: "alice",
          body: "github file comment",
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
          author: "alice",
          body: "github file comment",
          outdated: false,
        },
      ],
      conversationComposer: stubComposer(),
    });
    expect(screen.queryByText("github file comment")).toBeNull();
  });
});

describe("FileCommentBand mention source hand-off", () => {
  it("offers the conversation's participants in the file composer", () => {
    renderCard({ conversationComposer: stubMentionComposer() });
    fireEvent.click(
      screen.getByRole("button", { name: "Add a comment on src/a.ts" }),
    );
    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "@" },
    });
    expect(readOptionLabels()).toEqual(["@carol"]);
  });

  it("offers the conversation's participants in a file draft's editor", () => {
    renderCard({
      conversationComposer: stubMentionComposer(),
      session: makeFileDraftSession(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit comment"), {
      target: { value: "@" },
    });
    expect(readOptionLabels()).toEqual(["@carol"]);
  });
});
