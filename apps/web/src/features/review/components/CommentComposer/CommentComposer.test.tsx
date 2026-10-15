// @vitest-environment jsdom
// The submit label's count is selected from the store inside the composer:
// this pins the store-to-label wiring itself, not just the
// reviewCommentSubmitLabel helper.
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { RequestBounds } from "contract";
import { describe, expect, it, vi } from "vitest";

import { hasUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import { buildBriefViewModel, type Brief } from "@web/features/brief/model";
import { type CommentAnchor } from "../../utils/comments";
import { appI18n } from "../../../../i18n/I18nProvider";
import {
  createReviewFlowStore,
  ReviewFlowProvider,
  ReviewSessionProvider,
  type ReviewSessionPayload,
} from "../../session";
import { CommentComposer } from ".";
import { useCommentComposerFacade } from "./useCommentComposerFacade";
import {
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
} from "types/comments";

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
  chunks: [
    {
      id: "chunk-a",
      changeGroupId: "g1",
      file: "src/a.ts",
      concern: "implementation",
      role: "core",
      loc: { added: 1, deleted: 0 },
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "add", content: "a();", newLine: 11 }],
    },
  ],
  concernView: [],
};

const anchor: CommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: DiffSides.NEW,
  startLine: 11,
  endLine: 11,
  rowIds: ["chunk-a-row-0"],
  selectedText: "a();",
};

function sessionWith(
  draftComments: ReviewSessionPayload["draftComments"],
): ReviewSessionPayload {
  return {
    materialized: false,
    attention: [],
    reviewOutcome: "comment",
    draftComments,
    readMarks: [],
    reclassifications: [],
    dispositions: [],
    submittedReviewIds: [],
  };
}

/** The page live region an upload reports to; nothing here uploads. */
function makeFlowStore() {
  return createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
      reanchorComment: vi.fn(),
    },
    appI18n.t,
  );
}

function renderComposer(draftComments: ReviewSessionPayload["draftComments"]) {
  render(
    <ReviewSessionProvider
      briefId="test-brief"
      model={buildBriefViewModel(brief)}
      session={sessionWith(draftComments)}
    >
      <ReviewFlowProvider store={makeFlowStore()}>
        <CommentComposer anchor={anchor} cancel={vi.fn()} save={vi.fn()} />
      </ReviewFlowProvider>
    </ReviewSessionProvider>,
  );
}

describe("CommentComposer store-backed submit label", () => {
  it('reads "Start review" from an empty store', () => {
    renderComposer([]);
    expect(screen.getByRole("button", { name: "Start review" })).toBeTruthy();
  });

  it('reads "Add review comment" once the store holds a comment', () => {
    renderComposer([
      {
        id: "41",
        kind: CommentAnchorKinds.LINE,
        filePath: "src/a.ts",
        side: DiffSides.NEW,
        startLine: 11,
        endLine: 11,
        body: "existing",
        status: DraftCommentStatuses.DRAFT,
      },
    ]);
    expect(
      screen.getByRole("button", { name: "Add review comment" }),
    ).toBeTruthy();
  });
});

describe("CommentComposer line count", () => {
  it("counts the rows of an anchor the table gave row ids", () => {
    renderComposer([]);
    expect(screen.getByText("1 line")).toBeTruthy();
  });

  it("counts the span of an anchor that carries no row ids", () => {
    render(
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(brief)}
        session={sessionWith([])}
      >
        <ReviewFlowProvider store={makeFlowStore()}>
          <CommentComposer
            anchor={{ ...anchor, startLine: 2, endLine: 4, rowIds: [] }}
            cancel={vi.fn()}
            save={vi.fn()}
          />
        </ReviewFlowProvider>
      </ReviewSessionProvider>,
    );
    expect(screen.getByText("3 lines")).toBeTruthy();
  });
});

describe("CommentComposer navigation-guard registration", () => {
  it("registers while holding never-saved text, releases on unmount", () => {
    renderComposer([]);
    expect(hasUnsavedComposerText()).toBe(false);
    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "wip thought" },
    });
    expect(hasUnsavedComposerText()).toBe(true);
    cleanup();
    expect(hasUnsavedComposerText()).toBe(false);
  });
});

describe("CommentComposer while an image uploads", () => {
  it("holds the save and says why until the upload lands", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useCommentComposerFacade(anchor, save));

    act(() =>
      result.current.onBodyChange("look at this\n![Uploading shot.png…]()"),
    );
    act(() => result.current.submit());

    expect(save).not.toHaveBeenCalled();
    expect(result.current.error).toBe(
      "An image is still uploading; wait for it to land before submitting.",
    );

    act(() =>
      result.current.onBodyChange("look at this\n![Image](https://x/y.png)"),
    );
    act(() => result.current.submit());

    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("CommentComposer request bounds", () => {
  it("holds a body over the bound and keeps it for shortening", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useCommentComposerFacade(anchor, save));
    const overBound = "x".repeat(RequestBounds.BODY_LENGTH + 1);

    act(() => result.current.onBodyChange(overBound));
    act(() => result.current.submit());

    expect(save).not.toHaveBeenCalled();
    expect(result.current.body).toBe(overBound);
    expect(result.current.error).toBe(
      "This comment is longer than the 65,536-character limit. Shorten it to save.",
    );

    act(() => result.current.onBodyChange(overBound.slice(1)));
    act(() => result.current.submit());

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("measures the body the save sends, without its outer whitespace", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useCommentComposerFacade(anchor, save));

    act(() =>
      result.current.onBodyChange(
        `  ${"x".repeat(RequestBounds.BODY_LENGTH)}\n`,
      ),
    );
    act(() => result.current.submit());

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("holds a comment on a file whose path is over the bound", () => {
    const save = vi.fn();
    const longPath = {
      ...anchor,
      file: "x".repeat(RequestBounds.PATH_LENGTH + 1),
    };
    const { result } = renderHook(() =>
      useCommentComposerFacade(longPath, save),
    );

    act(() => result.current.onBodyChange("looks off"));
    act(() => result.current.submit());

    expect(save).not.toHaveBeenCalled();
    expect(result.current.error).toBe(
      "This file's path is too long to hold a comment. Cancel this comment to continue.",
    );
  });
});

describe("CommentComposer error association", () => {
  it("associates the empty-body error with the textarea", () => {
    renderComposer([]);
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Comment cannot be empty.");
    const input = screen.getByLabelText("Comment");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
  });
});
