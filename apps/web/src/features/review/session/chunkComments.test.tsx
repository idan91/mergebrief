// @vitest-environment jsdom
// BRIEF-27: the per-chunk comment selector must keep a stable array
// identity while the chunk's own slice is unchanged — that identity is
// what lets React.memo on ChunkCard actually skip re-renders.
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { Brief } from "../../brief/types";
import { buildBriefViewModel } from "../../brief/viewModel";
import type { CommentAnchor } from "../comments";
import { MindMapProvider, useChunkReviewComments, useMindMap } from ".";

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
    {
      id: "chunk-b",
      changeGroupId: "g1",
      file: "src/b.ts",
      concern: "implementation",
      role: "supporting",
      loc: { added: 1, deleted: 0 },
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "add", content: "b();", newLine: 21 }],
    },
  ],
  concernView: [],
};

function anchorFor(chunkId: string, line: number): CommentAnchor {
  return {
    chunkId,
    file: `src/${chunkId.slice(-1)}.ts`,
    side: "new",
    startLine: line,
    endLine: line,
    rowIds: [`${chunkId}-row-0`],
    selectedText: "code",
  };
}

export interface MindMapTestWrapperProps {
  children: ReactNode;
}

function MindMapTestWrapper({ children }: MindMapTestWrapperProps) {
  return (
    <MindMapProvider briefId="test-brief" model={buildBriefViewModel(brief)}>
      {children}
    </MindMapProvider>
  );
}

describe("useChunkReviewComments (BRIEF-27)", () => {
  it("keeps identity stable across other chunks' comment interactions", () => {
    const { result } = renderHook(
      () => ({
        a: useChunkReviewComments("chunk-a"),
        b: useChunkReviewComments("chunk-b"),
        actions: useMindMap((state) => state.actions),
      }),
      { wrapper: MindMapTestWrapper },
    );
    // Baseline BEFORE the unrelated save: the save itself is the ticket's
    // headline interaction, so identity churn during it must fail here.
    const bBeforeSave = result.current.b;
    act(() => {
      result.current.actions.saveComment({
        anchor: anchorFor("chunk-a", 11),
        body: "first",
        collapsed: false,
        status: "draft",
      });
    });
    const aAfterSave = result.current.a;
    const bAfterSave = result.current.b;
    expect(aAfterSave).toHaveLength(1);
    expect(bAfterSave).toBe(bBeforeSave);

    // Edit, toggle, then delete chunk-a's comment: chunk-b's slice must
    // keep the exact same identity through all three.
    const commentId = aAfterSave[0]!.id;
    act(() => result.current.actions.updateComment(commentId, "edited"));
    expect(result.current.b).toBe(bAfterSave);
    expect(result.current.a).not.toBe(aAfterSave);
    expect(result.current.a[0]!.body).toBe("edited");

    const aAfterEdit = result.current.a;
    act(() => result.current.actions.toggleComment(commentId));
    expect(result.current.b).toBe(bAfterSave);
    expect(result.current.a).not.toBe(aAfterEdit);

    act(() => result.current.actions.deleteComment(commentId));
    expect(result.current.b).toBe(bAfterSave);
    expect(result.current.a).toHaveLength(0);
  });

  it("selects only the chunk's own comments", () => {
    const { result } = renderHook(
      () => ({
        a: useChunkReviewComments("chunk-a"),
        b: useChunkReviewComments("chunk-b"),
        actions: useMindMap((state) => state.actions),
      }),
      { wrapper: MindMapTestWrapper },
    );
    act(() => {
      result.current.actions.saveComment({
        anchor: anchorFor("chunk-a", 11),
        body: "on a",
        collapsed: false,
        status: "draft",
      });
      result.current.actions.saveComment({
        anchor: anchorFor("chunk-b", 21),
        body: "on b",
        collapsed: false,
        status: "draft",
      });
    });
    expect(result.current.a.map((comment) => comment.body)).toEqual(["on a"]);
    expect(result.current.b.map((comment) => comment.body)).toEqual(["on b"]);
  });
});
