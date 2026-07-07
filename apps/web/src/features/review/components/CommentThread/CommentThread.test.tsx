// @vitest-environment jsdom
// Submitted comments are read-only records (BRIEF-23): GitHub holds the
// posted text, and a re-submit ships drafts only — so Edit/Delete must not
// be offered once a comment has been posted.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReviewComment } from "../../comments";
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
