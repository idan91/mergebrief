// @vitest-environment jsdom
// The submit label's count is selected from the store inside the composer:
// this pins the store-to-label wiring itself, not just the
// reviewCommentSubmitLabel helper.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render as renderBare,
  renderHook,
  screen,
} from "@testing-library/react";
import { useState, type ReactElement, type ReactNode } from "react";
import { RequestBounds } from "contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, ButtonVariants } from "@web/components/Button";
import { MentionCandidateKinds } from "@web/components/MarkdownTextarea/types";
import { hasUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import { buildBriefViewModel, type Brief } from "@web/features/brief/model";
import { type CommentAnchor } from "../../utils/comments";
import { appI18n } from "../../../../i18n/I18nProvider";
import {
  ComposerStateKinds,
  createReviewFlowStore,
  getComposerAnchor,
  isComposerSaving,
  ReviewFlowProvider,
  ReviewSessionProvider,
  useReviewActions,
  useReviewFlow,
  type ReviewFlowSessionActions,
  type ReviewFlowStore,
  type ReviewSessionPayload,
} from "../../session";
import { CommentComposer } from ".";
import composerFormStyles from "./ComposerForm/ComposerForm.module.scss";
import { useComposerFormFacade } from "./ComposerForm/useComposerFormFacade";
import { buildUnsavedCommentKey } from "./unsaved-text-storage";
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

export interface QueryWrapperProps {
  children: ReactNode;
}

/** The mention search reads the query client, so every render sits under one. */
function QueryWrapper({ children }: QueryWrapperProps) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function render(ui: ReactElement) {
  return renderBare(ui, { wrapper: QueryWrapper });
}

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

describe("CommentComposer actions", () => {
  it("reads Cancel then the submit action", () => {
    renderComposer([]);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const submit = screen.getByRole("button", { name: "Start review" });
    const submitFollows =
      cancel.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(submitFollows).toBeTruthy();
  });

  it("leaves the primary to the header's Submit", () => {
    renderComposer([]);

    const submit = screen.getByRole("button", { name: "Start review" });
    expect(submit.dataset["variant"]).toBe(ButtonVariants.SECONDARY);
  });

  it("ranks Start review over Cancel through their own skins", () => {
    renderComposer([]);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const submit = screen.getByRole("button", { name: "Start review" });
    expect(cancel.dataset["variant"]).toBe(ButtonVariants.GHOST);
    expect(submit.className).toContain(composerFormStyles["submit"]);
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
    const save = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useComposerFormFacade(anchor, save));

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
    const save = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useComposerFormFacade(anchor, save));
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
    const save = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useComposerFormFacade(anchor, save));

    act(() =>
      result.current.onBodyChange(
        `  ${"x".repeat(RequestBounds.BODY_LENGTH)}\n`,
      ),
    );
    act(() => result.current.submit());

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("holds a comment on a file whose path is over the bound", () => {
    const save = vi.fn(() => Promise.resolve(true));
    const longPath = {
      ...anchor,
      file: "x".repeat(RequestBounds.PATH_LENGTH + 1),
    };
    const { result } = renderHook(() => useComposerFormFacade(longPath, save));

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

describe("CommentComposer mention source hand-off", () => {
  it("offers the source's participants when the body starts a mention", () => {
    render(
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(brief)}
        session={sessionWith([])}
      >
        <ReviewFlowProvider store={makeFlowStore()}>
          <CommentComposer
            anchor={anchor}
            cancel={vi.fn()}
            mentionSource={{
              participants: [
                { kind: MentionCandidateKinds.USER, login: "carol" },
              ],
            }}
            save={vi.fn()}
          />
        </ReviewFlowProvider>
      </ReviewSessionProvider>,
    );
    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "@" },
    });
    expect(
      screen.getAllByRole("option").map((option) => option.textContent?.trim()),
    ).toEqual(["@carol"]);
  });
});

interface ComposerHarnessProps {
  cancel: () => void;
  saving?: boolean;
  children?: ReactNode;
}

function ComposerHarness({ cancel, saving, children }: ComposerHarnessProps) {
  return (
    <ReviewSessionProvider
      briefId="test-brief"
      model={buildBriefViewModel(brief)}
      session={sessionWith([])}
    >
      <ReviewFlowProvider store={makeFlowStore()}>
        <CommentComposer
          anchor={anchor}
          cancel={cancel}
          save={vi.fn()}
          saving={saving}
        />
        {children}
      </ReviewFlowProvider>
    </ReviewSessionProvider>
  );
}

describe("CommentComposer while the save is in flight", () => {
  it("cancels on Escape while idle", () => {
    const cancel = vi.fn();
    render(<ComposerHarness cancel={cancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while saving", () => {
    const cancel = vi.fn();
    render(<ComposerHarness cancel={cancel} saving />);
    fireEvent.keyDown(screen.getByLabelText("Comment"), { key: "Escape" });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("keeps Cancel focusable and aria-disabled while saving", () => {
    render(<ComposerHarness cancel={vi.fn()} saving />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    expect(cancel.hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Comment").readOnly).toBe(
      true,
    );
  });

  it("leaves an Escape pressed inside a dialog to the dialog", () => {
    const cancel = vi.fn();
    render(
      <ComposerHarness cancel={cancel}>
        <div aria-label="Submit review" role="dialog">
          <Button>Post</Button>
        </div>
      </ComposerHarness>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Post" }), {
      key: "Escape",
    });
    expect(cancel).not.toHaveBeenCalled();
  });
});

const otherAnchor: CommentAnchor = {
  ...anchor,
  startLine: 12,
  endLine: 12,
  rowIds: [],
};

/** Shows the store's open composer the way a diff table does. */
function OpenComposer() {
  const actions = useReviewActions();
  const open = useReviewFlow((state) => getComposerAnchor(state.composer));
  const saving = useReviewFlow((state) => isComposerSaving(state.composer));
  if (open === undefined) {
    return null;
  }
  return (
    <CommentComposer
      anchor={open}
      cancel={actions.cancelComposer}
      save={actions.saveComment}
      saving={saving}
    />
  );
}

function stubSessionActions(
  saveComment: ReviewFlowSessionActions["saveComment"],
): ReviewFlowSessionActions {
  return {
    saveComment,
    updateComment: vi.fn(() => Promise.resolve(true)),
    deleteComment: vi.fn(),
    toggleComment: vi.fn(),
    reanchorComment: vi.fn(() => false),
  };
}

function mountStoredComposer(
  briefId: string,
  saveComment: ReviewFlowSessionActions["saveComment"] = () =>
    Promise.resolve(true),
): ReviewFlowStore {
  const store = createReviewFlowStore(
    stubSessionActions(saveComment),
    appI18n.t,
    briefId,
  );
  render(
    <ReviewSessionProvider
      briefId={briefId}
      model={buildBriefViewModel(brief)}
      session={sessionWith([])}
    >
      <ReviewFlowProvider store={store}>
        <OpenComposer />
      </ReviewFlowProvider>
    </ReviewSessionProvider>,
  );
  return store;
}

function openAt(store: ReviewFlowStore, at: CommentAnchor): void {
  act(() => store.getState().actions.openComposer(at, undefined, "chunk-a"));
}

function typeComment(body: string): void {
  fireEvent.change(screen.getByLabelText("Comment"), {
    target: { value: body },
  });
}

function readComposerText(): string {
  return screen.getByLabelText<HTMLTextAreaElement>("Comment").value;
}

describe("CommentComposer unsaved text", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("brings the text back when replaced lines reopen", () => {
    const store = mountStoredComposer("brief-1");
    openAt(store, anchor);
    typeComment("first thought");

    openAt(store, otherAnchor);
    expect(readComposerText()).toBe("");
    openAt(store, anchor);

    expect(readComposerText()).toBe("first thought");
  });

  it("brings the text back after the host collapses and expands", () => {
    const store = mountStoredComposer("brief-1");
    openAt(store, anchor);
    typeComment("kept across collapse");

    act(() => store.getState().actions.dismissComposer());
    openAt(store, anchor);

    expect(readComposerText()).toBe("kept across collapse");
  });

  it("never shows one brief's text on another revision", () => {
    const first = mountStoredComposer("brief-1");
    openAt(first, anchor);
    typeComment("on revision one");
    cleanup();

    const second = mountStoredComposer("brief-2");
    openAt(second, anchor);

    expect(readComposerText()).toBe("");
  });

  it("discards the text on Cancel", () => {
    const store = mountStoredComposer("brief-1");
    openAt(store, anchor);
    typeComment("never mind");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    openAt(store, anchor);

    expect(readComposerText()).toBe("");
  });

  it("clears the text once the save lands", async () => {
    const store = mountStoredComposer("brief-1");
    openAt(store, anchor);
    typeComment("ship it");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    });
    openAt(store, anchor);

    expect(readComposerText()).toBe("");
  });

  it("keeps the text when the save fails", async () => {
    const store = mountStoredComposer("brief-1", () => Promise.resolve(false));
    openAt(store, anchor);
    typeComment("try again");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    });
    expect(readComposerText()).toBe("try again");
    act(() => store.getState().actions.dismissComposer());
    openAt(store, anchor);

    expect(readComposerText()).toBe("try again");
  });

  it("keeps the text when the save throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = mountStoredComposer("brief-1", () =>
      Promise.reject(new Error("network")),
    );
    openAt(store, anchor);
    typeComment("still here");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    });

    expect(readComposerText()).toBe("still here");
    expect(store.getState().composer.kind).toBe(ComposerStateKinds.OPEN);
  });

  it("works in memory when storage is denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const store = mountStoredComposer("brief-1");
    openAt(store, anchor);

    typeComment("only here");

    expect(readComposerText()).toBe("only here");
    expect(hasUnsavedComposerText()).toBe(true);
  });

  it("drops an upload placeholder that will never land and says so", () => {
    const store = mountStoredComposer("brief-1");
    openAt(store, anchor);
    typeComment("see this\n![Uploading shot.png…]()");
    act(() => store.getState().actions.dismissComposer());

    openAt(store, anchor);

    expect(readComposerText()).toBe("see this\n");
    expect(screen.getByRole("alert").textContent).toBe(
      "An image upload did not finish. Attach the image again.",
    );
  });

  it("clears restored text that lost its upload once the save lands", async () => {
    const store = mountStoredComposer("brief-1");
    openAt(store, anchor);
    typeComment("see this\n![Uploading shot.png…]()");
    act(() => store.getState().actions.dismissComposer());
    openAt(store, anchor);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    });
    openAt(store, anchor);

    expect(readComposerText()).toBe("");
  });

  it("clears the older stored text when a later write failed", async () => {
    const store = mountStoredComposer("brief-1");
    openAt(store, anchor);
    typeComment("first");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    typeComment("first and more");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    });
    openAt(store, anchor);

    expect(readComposerText()).toBe("");
  });

  it("keeps text stored after the save started", async () => {
    let landSave: (saved: boolean) => void = () => undefined;
    const store = mountStoredComposer(
      "brief-1",
      () =>
        new Promise((resolve) => {
          landSave = resolve;
        }),
    );
    openAt(store, anchor);
    typeComment("ship it");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    });

    const key = buildUnsavedCommentKey("brief-1", anchor, "chunk-a") ?? "";
    sessionStorage.setItem(key, "stored mid-save");
    await act(async () => landSave(true));
    openAt(store, anchor);

    expect(readComposerText()).toBe("stored mid-save");
  });

  it("leaves the navigation guard to storage when text is kept", () => {
    const store = mountStoredComposer("brief-1");
    openAt(store, anchor);

    typeComment("persisted as typed");

    expect(hasUnsavedComposerText()).toBe(false);
  });
});
