// @vitest-environment jsdom
// Submitted comments are read-only records (BRIEF-23): GitHub holds the
// posted text, and a re-submit ships drafts only — so Edit/Delete must not
// be offered once a comment has been posted.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReviewComment } from "../../utils/comments";
import { CommentThread } from "./CommentThread";

function comment(status: ReviewComment["status"]): ReviewComment {
  return {
    id: "c1",
    anchor: {
      chunkId: "chunk-a",
      file: "src/a.ts",
      side: "new",
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
    renderThread("draft");
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("is read-only once submitted — no Edit/Delete, posted label", () => {
    renderThread("submitted");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText(/posted to GitHub/i)).toBeDefined();
  });

  // Post-now (BRIEF-43): the Post affordance exists ONLY when the own-draft
  // route injected the `post` action — its absence is what keeps the reviewer
  // state (and every non-current-head own-draft view) untouched (ADR 0004).
  it("shows no Post button when the post action is absent (reviewer state)", () => {
    renderThread("draft");
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  });

  it("offers Post on a draft when the post action is injected, and calls it", () => {
    const post = vi.fn();
    const draft = comment("draft");
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

  it("renders Post as a primary CTA anchored in the draft card footer", () => {
    // BRIEF-43 UX follow-up: Post is promoted from a tiny inline text button to
    // a primary CTA at the bottom-right of the footer. Asserted via the footer
    // container + data attribute, never hashed class names.
    const post = vi.fn();
    render(
      <CommentThread
        comment={comment("draft")}
        deleteComment={vi.fn()}
        post={post}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Post" });
    // Primary-styled and tagged as the post CTA.
    expect(button.className).toContain("primary");
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
    // In-flight (4a): mutating controls disable so a mid-flight edit cannot
    // produce a submitted record whose body was never posted; Collapse (a
    // pure view toggle) stays live.
    const post = vi.fn();
    render(
      <CommentThread
        comment={comment("draft")}
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
    expect(postButton.disabled).toBe(true);
    postButton.click();
    expect(post).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Collapse" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("blocks Post while the inline editor is open, re-enabling on cancel", async () => {
    // Reviewer round 2 #2: Post ships the last SAVED body — with the editor
    // holding unsaved text, a post would silently discard the amendment when
    // the success flip lands. Post must block until the edit is saved or
    // cancelled.
    const post = vi.fn();
    render(
      <CommentThread
        comment={comment("draft")}
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
    expect(postButton.disabled).toBe(true);
    fireEvent.click(postButton);
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/Save or cancel your edit first/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      (screen.getByRole("button", { name: "Post" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("blocks Post with recoverable copy when the body exceeds the route cap", () => {
    // Deterministic-400 mirror (apps/web AGENTS.md): an over-cap body would
    // 400 at the route and the UI would resubmit the same draft — the
    // affordance must block client-side with a reason instead.
    const post = vi.fn();
    const overlong = { ...comment("draft"), body: "x".repeat(65_537) };
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
    expect(postButton.disabled).toBe(true);
    postButton.click();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/65,536-character limit/)).toBeDefined();
  });

  it("blocks Post with delete-the-draft copy when the anchor path exceeds the route cap", () => {
    // Route MAX_PATH_LENGTH mirror (reviewer round 4 #1): an over-long path
    // is a deterministic 400 no edit can fix — the only recovery is deleting
    // the draft, so the copy must say that (mirrors submitBlockedReason).
    const post = vi.fn();
    const base = comment("draft");
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
    expect(postButton.disabled).toBe(true);
    fireEvent.click(postButton);
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/path is too long to post/)).toBeDefined();
  });

  it("blocks Post with the external wait reason while a review submit is in flight", () => {
    // Reviewer round 7 #2 (the reverse race): a Submit review in flight
    // already CAPTURED this draft — posting it mid-submit would double-post
    // it when the review lands. The screen passes the wait-shaped reason and
    // the affordance must disable with it.
    const post = vi.fn();
    const reason =
      "A review is being submitted — wait for it to finish before posting this comment.";
    render(
      <CommentThread
        comment={comment("draft")}
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
    expect(postButton.disabled).toBe(true);
    fireEvent.click(postButton);
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(reason)).toBeDefined();
  });

  it("keeps the posting lockdown when the post action is gone (own-draft exit mid-post)", () => {
    // Reviewer round 6 #1: the own-draft state can exit while a post is
    // settling (mark-ready confirmed, same span → no remount). The ACTION
    // vanishes with the plan, but Edit/Delete must stay locked on the
    // still-posting draft — re-enabled controls could flip a submitted
    // record whose edited body never posted, or orphan the GitHub comment
    // on delete.
    render(
      <CommentThread
        comment={comment("draft")}
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
      (screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("never offers Post on an already-submitted comment", () => {
    render(
      <CommentThread
        comment={comment("submitted")}
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
        comment={comment("draft")}
        deleteComment={vi.fn()}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: "Edit" }).click();
    expect(await screen.findByRole("textbox")).toBeDefined();

    rerender(
      <CommentThread
        comment={comment("submitted")}
        deleteComment={vi.fn()}
        toggle={vi.fn()}
        update={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
