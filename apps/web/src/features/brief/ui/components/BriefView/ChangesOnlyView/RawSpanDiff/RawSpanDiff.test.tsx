// @vitest-environment jsdom
import {
  ReviewCommentSides,
  ThreadSubjectTypes,
  type ReviewCommentSide,
} from "types/conversation";
import { Concerns, Roles } from "brief-core/types";
import { appI18n } from "../../../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError, ApiErrorCodes } from "@web/data/apiFetch";

import {
  createReviewFlowStore,
  ReviewSessionProvider,
  ReviewFlowProvider,
  type ReviewFlowStore,
  useReviewSessionActions,
} from "@web/features/review/session";
import {
  type DigestThreadRow,
  DigestRowKinds,
  ThreadPlacementKinds,
} from "@web/features/conversation/utils";
import type { DiffLine } from "@web/utils/diffTokens/types";
import { type ReactNode, useState } from "react";
import type { ComparisonQuery } from "../../../../../model/comparison/comparison-query";
import { FileRowsProvider } from "../../../../../model/file-rows/useFileRows";
import { type Brief, type BriefChunk } from "../../../../../model/types";
import type { FileRowsCache } from "../../../../../model/file-rows/cache";
import { stubFileRowsCache } from "../../../../../test-utils/fixtures";
import { buildLineOwnersByFile } from "../../../../../model/utils/line-owner";
import { buildBriefViewModel } from "../../../../../model/utils/view-model";
import { DiffTable } from "../../DiffTable";
import type { ChangesReviewWiring } from "../types";
import { RawSpanDiff } from ".";
import { ReviewPostureProvider } from "../../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../../utils/review-posture";

/** The span diff: its left side is the baseline, which had a log line head lacks. */
const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " const a = 1;",
  "-console.log(a);",
  "+validate(a);",
  " export { a };",
].join("\n");

/** The PR base to head rows of the file: the guard is the one added line. */
const FILE_ROWS: DiffLine[] = [
  { kind: "hunk", content: "@@ -1,2 +1,3 @@" },
  { kind: "ctx", content: "const a = 1;", oldLine: 1, newLine: 1 },
  { kind: "add", content: "validate(a);", newLine: 2 },
  { kind: "ctx", content: "export { a };", oldLine: 2, newLine: 3 },
];

const OWNER: BriefChunk = {
  id: "c1",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: Concerns.IMPLEMENTATION,
  role: Roles.CORE,
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 2, end: 2 }],
  removedRanges: [],
  riskSurface: [],
  diff: FILE_ROWS,
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
      title: "Tighten validation",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [OWNER],
  concernView: [],
};

const FILE_ROWS_CACHE: FileRowsCache = stubFileRowsCache((path) =>
  path === "src/a.ts" ? FILE_ROWS : undefined,
);

function diffQuery(
  base: string,
  head: string,
  body = DIFF,
): ComparisonQuery<string> {
  return {
    queryKey: ["pr-diff", "424242", 7, base, head],
    queryFn: async (): Promise<string> => body,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  };
}

const THREAD_COMPOSER = {
  post: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
  onPosted: vi.fn(),
};

const NO_DIFF_CACHE: FileRowsCache = stubFileRowsCache(() => undefined, true);

function stubThread(
  side: ReviewCommentSide,
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

interface LiveFlowProps {
  onStore: (store: ReviewFlowStore) => void;
  children: ReactNode;
}

/** A flow store wired to the session, so a save lands in the session store. */
function LiveFlow({ onStore, children }: LiveFlowProps) {
  const actions = useReviewSessionActions();
  const [store] = useState(() => {
    const created = createReviewFlowStore(actions, appI18n.t);
    onStore(created);
    return created;
  });

  return <ReviewFlowProvider store={store}>{children}</ReviewFlowProvider>;
}

interface RenderOptions {
  client?: QueryClient;
  /** Render the owner's own table beside the span, as Full would. */
  withOwnerTable?: boolean;
  /** The screen's read-only reason for comments. */
  composerDisabledReason?: string;
  /** The PR diff rows; defaults to the loaded file. */
  cache?: FileRowsCache;
  fileThreads?: DigestThreadRow[];
  /** Wire the flow store to the session instead of stubbing its gateway. */
  liveSession?: boolean;
}

function renderRaw(
  query: ComparisonQuery<string>,
  options: RenderOptions = {},
) {
  const client =
    options.client ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let flowStore = createReviewFlowStore(
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
  const model = buildBriefViewModel(BRIEF);
  const review: ChangesReviewWiring = {
    lineOwnersByFile: buildLineOwnersByFile(model, appI18n.t),
    lineThreadsByFile:
      options.fileThreads === undefined
        ? undefined
        : new Map([["src/a.ts", options.fileThreads]]),
    conversationComposer: THREAD_COMPOSER,
  };
  const posture = makeReviewPosture({
    composerDisabledReason: options.composerDisabledReason,
  });
  const tables = (
    <>
      <RawSpanDiff query={query} review={review}>
        <p>Changes Only summary</p>
      </RawSpanDiff>
      {options.withOwnerTable === true ? (
        <div data-testid="owner-table">
          <DiffTable
            addressedComments={[]}
            chunk={OWNER}
            comparisonSkipReason={null}
            comparisonSource={{ kind: "last-review", delta: null }}
            comparisonView={{
              marks: new Map(),
              runs: [],
              runByRow: new Map(),
            }}
            reviewCommentLabel="review comment"
          />
        </div>
      ) : null}
    </>
  );
  const view = render(
    <QueryClientProvider client={client}>
      <FileRowsProvider cache={options.cache ?? FILE_ROWS_CACHE}>
        <ReviewSessionProvider briefId="test-brief" model={model}>
          <ReviewPostureProvider posture={posture}>
            {options.liveSession === true ? (
              <LiveFlow
                onStore={(store) => {
                  flowStore = store;
                }}
              >
                {tables}
              </LiveFlow>
            ) : (
              <ReviewFlowProvider store={flowStore}>
                {tables}
              </ReviewFlowProvider>
            )}
          </ReviewPostureProvider>
        </ReviewSessionProvider>
      </FileRowsProvider>
    </QueryClientProvider>,
  );

  return { ...view, flowStore, openCommentComposer };
}

function findSpanRow(container: HTMLElement, content: string): HTMLElement {
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-line-origin="guest"][data-line-kind]',
    ),
  );
  const row = rows.find((candidate) =>
    candidate.textContent?.includes(content),
  );
  if (row === undefined) {
    throw new Error(`no span row shows ${content}`);
  }
  return row;
}

/** The toggle button: its accessible NAME is stable, only aria-pressed flips. */
function toggleButton() {
  return screen.getByRole("button", { name: "Raw diff" });
}

describe("RawSpanDiff toggle", () => {
  it("renders the raw diff through DiffTable when toggled on", async () => {
    renderRaw(diffQuery("prev", "head"));
    fireEvent.click(toggleButton());

    // Stable accessible name across presses; state lives in aria-pressed.
    expect(toggleButton().getAttribute("aria-pressed")).toBe("true");
    // The summary is swapped out for the raw diff.
    expect(screen.queryByText("Changes Only summary")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText("src/a.ts")).toBeTruthy();
      expect(screen.getByText("validate(a);")).toBeTruthy();
    });
  });

  it("anchors a comment on a right-side row to the chunk owning its line", async () => {
    const { container, openCommentComposer } = renderRaw(
      diffQuery("chk", "head"),
    );
    fireEvent.click(toggleButton());
    await waitFor(() => expect(screen.getByText("validate(a);")).toBeTruthy());
    const row = findSpanRow(container, "validate(a);");

    expect(row.hasAttribute("data-commentable")).toBe(true);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(openCommentComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: "c1",
        file: "src/a.ts",
        side: "new",
        startLine: 2,
        endLine: 2,
      }),
      undefined,
      "raw:src/a.ts",
    );
    expect(screen.getByText("1 line")).toBeTruthy();
  });

  it("keeps every span row inert under a read-only posture", async () => {
    const { container, openCommentComposer } = renderRaw(
      diffQuery("chk", "head"),
      { composerDisabledReason: "Frozen for this revision" },
    );
    fireEvent.click(toggleButton());
    await waitFor(() => expect(screen.getByText("validate(a);")).toBeTruthy());
    const row = findSpanRow(container, "validate(a);");

    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(row, { key: "Enter" });

    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("names the PR diff unavailable rather than lacking the line", async () => {
    const { container } = renderRaw(diffQuery("chk", "head"), {
      cache: NO_DIFF_CACHE,
    });
    fireEvent.click(toggleButton());
    await waitFor(() => expect(screen.getByText("validate(a);")).toBeTruthy());
    const row = findSpanRow(container, "validate(a);");
    const reasonId = row.getAttribute("aria-describedby") ?? "";

    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(reasonId)?.textContent).toBe(
      appI18n.t("brief.diff.guest.prDiffUnavailable"),
    );
  });

  it("shows a right-side thread on its span row and drops a left-side one", async () => {
    const { container } = renderRaw(diffQuery("chk", "head"), {
      fileThreads: [
        stubThread(ReviewCommentSides.RIGHT, 2, "right thread"),
        stubThread(ReviewCommentSides.LEFT, 2, "left thread"),
      ],
    });
    fireEvent.click(toggleButton());
    await waitFor(() => expect(screen.getByText("validate(a);")).toBeTruthy());
    const row = findSpanRow(container, "validate(a);");

    expect(row.nextElementSibling?.textContent).toContain("right thread");
    expect(screen.queryByText("left thread")).toBeNull();
  });

  it("saves a draft from the span row that the owner's table then shows", async () => {
    const { container } = renderRaw(diffQuery("chk", "head"), {
      liveSession: true,
      withOwnerTable: true,
    });
    fireEvent.click(toggleButton());
    await waitFor(() => findSpanRow(container, "validate(a);"));
    fireEvent.keyDown(findSpanRow(container, "validate(a);"), {
      key: "Enter",
    });
    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "from changes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));

    await waitFor(() =>
      expect(screen.getAllByText("from changes")).toHaveLength(2),
    );
    expect(screen.getByTestId("owner-table").textContent).toContain(
      "from changes",
    );
  });

  it("cancels an open composer when its file panel is collapsed", async () => {
    const { container, flowStore } = renderRaw(diffQuery("chk", "head"));
    fireEvent.click(toggleButton());
    await waitFor(() => expect(screen.getByText("validate(a);")).toBeTruthy());
    fireEvent.keyDown(findSpanRow(container, "validate(a);"), {
      key: "Enter",
    });
    expect(flowStore.getState().composerAnchor).not.toBeNull();
    const panel = container.querySelector("details");
    if (!(panel instanceof HTMLDetailsElement)) {
      throw new Error("expected a file panel");
    }

    panel.open = false;
    fireEvent(panel, new Event("toggle"));

    expect(flowStore.getState().composerAnchor).toBeNull();
  });

  it("cancels an open composer when the raw diff is toggled off", async () => {
    const { container, flowStore } = renderRaw(diffQuery("chk", "head"));
    fireEvent.click(toggleButton());
    await waitFor(() => expect(screen.getByText("validate(a);")).toBeTruthy());
    fireEvent.keyDown(findSpanRow(container, "validate(a);"), {
      key: "Enter",
    });
    expect(flowStore.getState().composerAnchor).not.toBeNull();

    fireEvent.click(toggleButton());

    await waitFor(() => expect(flowStore.getState().composerAnchor).toBeNull());
    expect(flowStore.getState().composerHost).toBeNull();
  });

  it("returns to the summary when toggled back off", async () => {
    renderRaw(diffQuery("prev", "head"));
    fireEvent.click(toggleButton());
    await waitFor(() => expect(screen.getByText("src/a.ts")).toBeTruthy());
    fireEvent.click(toggleButton());
    expect(toggleButton().getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Changes Only summary")).toBeTruthy();
    expect(screen.queryByText("src/a.ts")).toBeNull();
  });

  it("names a successful empty diff honestly, not as a failure", async () => {
    // Identical base/head content: the fetch succeeds with an empty body,
    // success-empty must not wear the error copy.
    renderRaw(diffQuery("prev", "head", ""));
    fireEvent.click(toggleButton());
    await waitFor(() =>
      expect(screen.getByText(/No raw changes in this span/)).toBeTruthy(),
    );
    expect(
      screen.queryByText("The raw diff is not viewable right now."),
    ).toBeNull();
  });

  it("keeps the not-viewable copy for a failed fetch", async () => {
    renderRaw({
      queryKey: ["pr-diff", "424242", 7, "prev", "head"],
      queryFn: async (): Promise<string> => {
        throw new Error("diff proxy unavailable");
      },
      retry: false,
    });
    fireEvent.click(toggleButton());
    await waitFor(() =>
      expect(
        screen.getByText("The raw diff is not viewable right now."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/No raw changes in this span/)).toBeNull();
  });

  it("offers a retry when GitHub did not render the span in time", async () => {
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new ApiError(ApiErrorCodes.DIFF_FETCH_TIMEOUT, 504, "/diff"),
      )
      .mockResolvedValueOnce(DIFF);
    renderRaw({
      queryKey: ["pr-diff", "424242", 7, "prev", "head"],
      queryFn,
      retry: false,
    });
    fireEvent.click(toggleButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("GitHub took too long");
    expect(
      screen.queryByText("The raw diff is not viewable right now."),
    ).toBeNull();
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(document.activeElement?.textContent).toContain("src/a.ts");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Diff loaded."),
    );
  });

  it("keeps focus on Try again when the span times out again", async () => {
    const timeout = new ApiError(
      ApiErrorCodes.DIFF_FETCH_TIMEOUT,
      504,
      "/diff",
    );
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(timeout);
    renderRaw({
      queryKey: ["pr-diff", "424242", 7, "prev", "head"],
      queryFn,
      retry: false,
    });
    fireEvent.click(toggleButton());
    const button = await screen.findByRole("button", { name: "Try again" });
    button.focus();

    fireEvent.click(button);

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toBe(button),
    );
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("moves focus to the note when the span retry fails otherwise", async () => {
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new ApiError(ApiErrorCodes.DIFF_FETCH_TIMEOUT, 504, "/diff"),
      )
      .mockRejectedValueOnce(
        new ApiError(ApiErrorCodes.GITHUB_UNAVAILABLE, 502, "/diff"),
      );
    renderRaw({
      queryKey: ["pr-diff", "424242", 7, "prev", "head"],
      queryFn,
      retry: false,
    });
    fireEvent.click(toggleButton());
    const button = await screen.findByRole("button", { name: "Try again" });
    button.focus();

    fireEvent.click(button);

    const note = await screen.findByText(
      "The raw diff is not viewable right now.",
    );
    expect(document.activeElement).toBe(note);
    expect(await screen.findByText("The diff did not load.")).toBeTruthy();
  });

  it("a guarded descriptor vetoes cached data, the guard wins", async () => {
    // enabled: false only blocks FETCHING; react-query still serves a
    // previously-cached body for the same key.
    const queryKey = ["pr-diff", "424242", 7, "prev", "head"];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKey, DIFF);
    renderRaw(
      {
        queryKey,
        queryFn: async (): Promise<string> => DIFF,
        enabled: false,
        retry: false,
      },
      { client },
    );
    fireEvent.click(toggleButton());
    await waitFor(() =>
      expect(
        screen.getByText("The raw diff is not viewable right now."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("validate(a);")).toBeNull();
    expect(screen.queryByText("src/a.ts")).toBeNull();
  });

  it("never fetches a descriptor that disabled itself", async () => {
    const queryFn = vi.fn(async (): Promise<string> => DIFF);
    renderRaw({
      queryKey: ["pr-diff", "424242", 7, "gone", "head"],
      queryFn,
      enabled: false,
      retry: false,
    });
    fireEvent.click(toggleButton());
    // The toggle gates the descriptor's own `enabled`; it must not force a
    // fetch the descriptor guarded against.
    await waitFor(() =>
      expect(
        screen.getByText("The raw diff is not viewable right now."),
      ).toBeTruthy(),
    );
    expect(queryFn).not.toHaveBeenCalled();
  });
});
