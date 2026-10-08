// @vitest-environment jsdom
// Submitted comments are read-only records: GitHub holds the posted text and
// a re-submit ships drafts only, so Edit/Delete must not be offered once a
// comment has been posted.
import {
  cleanup,
  fireEvent,
  render as renderBare,
  screen,
} from "@testing-library/react";
import { useState, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import {
  ReviewCommentStatuses,
  type ReviewComment,
} from "../../utils/comments";
import { createReviewFlowStore, ReviewFlowProvider } from "../../session";
import { appI18n } from "../../../../i18n/I18nProvider";
import { CommentThread } from ".";
import { CommentAnchorKinds, DiffSides } from "types/comments";

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

/** The editor reads the flow's announcer, so every render sits under it. */
function FlowWrapper({ children }: { children: ReactNode }) {
  const [store] = useState(makeFlowStore);
  return <ReviewFlowProvider store={store}>{children}</ReviewFlowProvider>;
}

function render(ui: ReactElement) {
  return renderBare(ui, { wrapper: FlowWrapper });
}

function comment(status: ReviewComment["status"]): ReviewComment {
  return {
    id: "c1",
    anchor: {
      kind: CommentAnchorKinds.LINE,
      chunkId: "chunk-a",
      file: "src/a.ts",
      side: DiffSides.NEW,
      startLine: 3,
      endLine: 3,
      rowIds: ["chunk-a:0"],
      selectedText: "x",
    },
    body: "note",
    status,
    collapsed: false,
  };
}

function renderThread(status: ReviewComment["status"]) {
  return render(
    <CommentThread
      comment={comment(status)}
      deleteComment={vi.fn()}
      toggle={vi.fn()}
      update={vi.fn()}
    />,
  );
}

describe("CommentThread", () => {
  // No vitest globals in this repo → testing-library does not auto-cleanup;
  // without this, test 1's draft DOM leaks into test 2's screen queries.
  afterEach(cleanup);

  it("offers Edit and Delete on a draft", () => {
    renderThread(ReviewCommentStatuses.DRAFT);
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("moves focus into the editor when Edit opens it", () => {
    renderThread(ReviewCommentStatuses.DRAFT);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Edit comment"));
  });

  it("registers a diverged edit with the navigation guard; Cancel releases", () => {
    renderThread(ReviewCommentStatuses.DRAFT);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(hasUnsavedComposerText()).toBe(false);
    fireEvent.change(screen.getByLabelText("Edit comment"), {
      target: { value: "note, amended" },
    });
    expect(hasUnsavedComposerText()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(hasUnsavedComposerText()).toBe(false);
  });

  it("Delete asks for confirmation; Keep aborts, Delete draft proceeds", () => {
    const deleteComment = vi.fn();
    render(
      <CommentThread
        comment={comment(ReviewCommentStatuses.DRAFT)}
        deleteComment={deleteComment}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteComment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText("Delete this draft?")).toBeNull();
    expect(deleteComment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    expect(deleteComment).toHaveBeenCalledWith("c1");
  });

  it("Cmd+Enter must not save while a Post is in flight", () => {
    // The Save button disables while posting, but Cmd+Enter reaches
    // saveEdit directly. The guard lives in the handler, not the button
    // (capture-at-initiation rule: a mid-flight save would flip the record
    // to `submitted` with a body the request never shipped).
    const update = vi.fn();
    const props = {
      comment: comment(ReviewCommentStatuses.DRAFT),
      deleteComment: vi.fn(),
      post: vi.fn(),
      toggle: vi.fn(),
      update,
    };
    const view = render(<CommentThread {...props} posting={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    view.rerender(<CommentThread {...props} posting />);
    fireEvent.keyDown(screen.getByLabelText("Edit comment"), {
      key: "Enter",
      metaKey: true,
    });
    expect(update).not.toHaveBeenCalled();
    view.rerender(<CommentThread {...props} posting={false} />);
    fireEvent.keyDown(screen.getByLabelText("Edit comment"), {
      key: "Enter",
      metaKey: true,
    });
    expect(update).toHaveBeenCalledWith("c1", "note");
  });

  it("Save holds while the body still carries an upload placeholder", () => {
    const update = vi.fn();
    const held = comment(ReviewCommentStatuses.DRAFT);
    render(
      <CommentThread
        comment={{ ...held, body: "note\n![Uploading shot.png…]()" }}
        deleteComment={vi.fn()}
        toggle={vi.fn()}
        update={update}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "An image is still uploading; wait for it to land before submitting.",
    );
  });

  it("is read-only once submitted with a posted label", () => {
    renderThread(ReviewCommentStatuses.SUBMITTED);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText(/posted to GitHub/i)).toBeDefined();
  });

  // The Post affordance exists ONLY when the own-draft route injected the
  // `post` action. Its absence keeps the reviewer state untouched.
  it("shows no Post button when the post action is absent", () => {
    renderThread(ReviewCommentStatuses.DRAFT);
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  });

  it("offers Post on a draft when the post action is injected, and calls it", () => {
    const post = vi.fn();
    const draft = comment(ReviewCommentStatuses.DRAFT);
    render(
      <CommentThread
        comment={draft}
        deleteComment={vi.fn()}
        post={post}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Post" });
    button.click();
    expect(post).toHaveBeenCalledWith(draft);
  });

  it("renders Post as the accent CTA anchored in the draft card footer", () => {
    // Asserted via the footer container + data attribute, never hashed
    // class names.
    const post = vi.fn();
    render(
      <CommentThread
        comment={comment(ReviewCommentStatuses.DRAFT)}
        deleteComment={vi.fn()}
        post={post}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Post" });
    // Primary-styled and tagged as the post CTA.
    expect(button.getAttribute("data-variant")).toBe("accent");
    expect(button.hasAttribute("data-post-cta")).toBe(true);
    // Lives inside the thread footer (the CTA slot), not loose in the DOM.
    const footer = button.closest("[data-thread-footer]");
    expect(footer).not.toBeNull();
    // The secondary text actions (Edit/Collapse/Delete) share that footer.
    expect(footer?.contains(screen.getByRole("button", { name: "Edit" }))).toBe(
      true,
    );
  });

  it("disables Post/Edit/Delete with a pending label while posting", () => {
    // In flight: mutating controls disable so a mid-flight edit cannot
    // produce a submitted record whose body was never posted; Collapse (a
    // pure view toggle) stays live.
    const post = vi.fn();
    render(
      <CommentThread
        comment={comment(ReviewCommentStatuses.DRAFT)}
        deleteComment={vi.fn()}
        post={post}
        posting
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    const postButton = screen.getByRole("button", {
      name: "Posting…",
    }) as HTMLButtonElement;
    expect(postButton.getAttribute("aria-disabled")).toBe("true");
    postButton.click();
    expect(post).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", { name: "Edit" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Delete" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Collapse" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("blocks Post while the inline editor is open, re-enabling on cancel", async () => {
    // Post ships the last SAVED body. With unsaved text in the editor, a
    // post would silently discard the amendment when the success flip lands.
    const post = vi.fn();
    render(
      <CommentThread
        comment={comment(ReviewCommentStatuses.DRAFT)}
        deleteComment={vi.fn()}
        post={post}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("textbox")).toBeDefined();

    const postButton = screen.getByRole("button", {
      name: "Post",
    }) as HTMLButtonElement;
    expect(postButton.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(postButton);
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/Save or cancel your edit first/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen
        .getByRole("button", { name: "Post" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("blocks Post with recoverable copy when the body exceeds the route cap", () => {
    // Deterministic-400 mirror: an over-cap body would
    // 400 at the route and the UI would resubmit the same draft. The
    // affordance must block client-side with a reason instead.
    const post = vi.fn();
    const overlong = {
      ...comment(ReviewCommentStatuses.DRAFT),
      body: "x".repeat(65_537),
    };
    render(
      <CommentThread
        comment={overlong}
        deleteComment={vi.fn()}
        post={post}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    const postButton = screen.getByRole("button", {
      name: "Post",
    }) as HTMLButtonElement;
    expect(postButton.getAttribute("aria-disabled")).toBe("true");
    postButton.click();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/65,536-character limit/)).toBeDefined();
  });

  it("blocks Post when the path exceeds the route cap", () => {
    // Route MAX_PATH_LENGTH mirror: an over-long path is a deterministic 400
    // no edit can fix. The only recovery is deleting the draft.
    const post = vi.fn();
    const base = comment(ReviewCommentStatuses.DRAFT);
    const overlongPath = {
      ...base,
      anchor: { ...base.anchor, file: `src/${"x".repeat(1_025)}.ts` },
    };
    render(
      <CommentThread
        comment={overlongPath}
        deleteComment={vi.fn()}
        post={post}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    const postButton = screen.getByRole("button", {
      name: "Post",
    }) as HTMLButtonElement;
    expect(postButton.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(postButton);
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/path is too long to post/)).toBeDefined();
  });

  it("blocks Post with the wait reason while a review is submitting", () => {
    // The reverse race: a Submit review in flight already CAPTURED this draft.
    // Posting it mid-submit would double-post it when the review lands.
    const post = vi.fn();
    const reason =
      "A review is being submitted — wait for it to finish before posting this comment.";
    render(
      <CommentThread
        comment={comment(ReviewCommentStatuses.DRAFT)}
        deleteComment={vi.fn()}
        post={post}
        postBlockedExternally={reason}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    const postButton = screen.getByRole("button", {
      name: "Post",
    }) as HTMLButtonElement;
    expect(postButton.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(postButton);
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(reason)).toBeDefined();
  });

  it("keeps posting lockdown when the post action is gone", () => {
    // The own-draft state can exit while a post is settling (same span → no
    // remount). The ACTION vanishes, but Edit/Delete must stay locked on the
    // still-posting draft. Re-enabled controls could flip a submitted record
    // whose edited body never posted, or orphan the GitHub comment on delete.
    render(
      <CommentThread
        comment={comment(ReviewCommentStatuses.DRAFT)}
        deleteComment={vi.fn()}
        posting
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    // No Post affordance (action gone with the own-draft plan)…
    expect(screen.queryByRole("button", { name: /Post/ })).toBeNull();
    // …but the mutating controls stay locked while the request settles.
    expect(
      screen
        .getByRole("button", { name: "Edit" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Delete" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("never offers Post on an already-submitted comment", () => {
    render(
      <CommentThread
        comment={comment(ReviewCommentStatuses.SUBMITTED)}
        deleteComment={vi.fn()}
        post={vi.fn()}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  });

  it("closes an open editor when the draft is submitted mid-edit", async () => {
    // Edit open → the submit lands (status flips via a rerender) → the
    // posted record must render read-only, not a live Save/Cancel editor.
    const { rerender } = render(
      <CommentThread
        comment={comment(ReviewCommentStatuses.DRAFT)}
        deleteComment={vi.fn()}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: "Edit" }).click();
    expect(await screen.findByRole("textbox")).toBeDefined();

    rerender(
      <CommentThread
        comment={comment(ReviewCommentStatuses.SUBMITTED)}
        deleteComment={vi.fn()}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
