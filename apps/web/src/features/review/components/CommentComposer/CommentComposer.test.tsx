// @vitest-environment jsdom
// BRIEF-27: the submit label's count is selected from the store inside the
// composer — this pins the store-to-label wiring itself, not just the
// reviewCommentSubmitLabel helper.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brief } from "../../../brief/types";
import { buildBriefViewModel } from "../../../brief/viewModel";
import type { CommentAnchor, ReviewComment } from "../../comments";
import { MindMapProvider, type SessionSnapshot } from "../../session";
import { CommentComposer } from "./CommentComposer";

afterEach(cleanup);

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
      role: "carrier",
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
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: "new",
  startLine: 11,
  endLine: 11,
  rowIds: ["chunk-a-row-0"],
  selectedText: "a();",
};

function snapshotWith(reviewComments: ReviewComment[]): SessionSnapshot {
  return {
    briefId: "test-brief",
    dispositions: {},
    dominants: {},
    reclassifiedGroupIds: [],
    reviewedChunkIds: [],
    checkedItems: {},
    reviewComments,
    reviewOutcome: "comment",
  };
}

function renderComposer(reviewComments: ReviewComment[]) {
  render(
    <MindMapProvider
      briefId="test-brief"
      model={buildBriefViewModel(brief)}
      snapshot={snapshotWith(reviewComments)}
    >
      <CommentComposer anchor={anchor} cancel={vi.fn()} save={vi.fn()} />
    </MindMapProvider>,
  );
}

describe("CommentComposer — store-backed submit label (BRIEF-27)", () => {
  it('reads "Start review" from an empty store', () => {
    renderComposer([]);
    expect(screen.getByRole("button", { name: "Start review" })).toBeTruthy();
  });

  it('reads "Add review comment" once the store holds a comment', () => {
    renderComposer([
      {
        id: "chunk-a-new-11-11-1",
        anchor,
        body: "existing",
        status: "draft",
        collapsed: false,
      },
    ]);
    expect(
      screen.getByRole("button", { name: "Add review comment" }),
    ).toBeTruthy();
  });
});
