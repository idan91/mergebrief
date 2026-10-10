// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { type Brief, buildBriefViewModel } from "@web/features/brief/model";
import { CommentAnchorKinds, DiffSides } from "types/comments";
import { ReviewSessionProvider, useReviewSession } from "..";
import {
  ReviewCommentStatuses,
  type CommentAnchor,
} from "../../utils/comments";
import { useCreateReviewFlowStore } from "./provider";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const brief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "t",
    url: "https://example.com/pr/7",
    sha: "aaaa1111",
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
      id: "c1",
      changeGroupId: "g1",
      file: "src/a.ts",
      concern: "implementation",
      role: "core",
      loc: { added: 1, deleted: 0 },
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "add", content: "x();", newLine: 11 }],
    },
  ],
  concernView: [],
};
const model = buildBriefViewModel(brief);

let currentBriefId = "brief-a";

function Wrapper({ children }: { children?: ReactNode }) {
  return (
    <ReviewSessionProvider briefId={currentBriefId} model={model}>
      {children}
    </ReviewSessionProvider>
  );
}

const anchor: CommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  chunkId: "c1",
  file: "src/a.ts",
  side: DiffSides.NEW,
  startLine: 11,
  endLine: 11,
  rowIds: ["row-1"],
  selectedText: "x();",
};

function useFlowAndSessionComments() {
  const flowStore = useCreateReviewFlowStore(currentBriefId);
  const sessionComments = useReviewSession((state) => state.reviewComments);
  return { flowStore, sessionComments };
}

describe("flow store per brief", () => {
  it("gives a switched brief a fresh flow store with nothing open", () => {
    currentBriefId = "brief-a";
    const { result, rerender } = renderHook(
      () => useCreateReviewFlowStore(currentBriefId),
      { wrapper: Wrapper },
    );
    const first = result.current;
    act(() => {
      first.getState().actions.setReviewComment("carried text");
      first.getState().actions.toggleConversationThread("src/a.ts#c1", 9001);
      first.getState().actions.startReanchor("draft-1", undefined);
      first.setState({ toast: "old toast", liveMessage: "old line" });
    });

    currentBriefId = "brief-b";
    rerender();

    const next = result.current.getState();
    expect(result.current).not.toBe(first);
    expect(next.reviewComment).toBe("");
    expect(next.toast).toBe("");
    expect(next.liveMessage).toBe("");
    expect(next.composerAnchor).toBeNull();
    expect(next.reanchorDraftId).toBeNull();
    expect(next.dismissTarget).toBeNull();
    expect(next.evidenceTarget).toBeNull();
    expect(next.selectedRiskFlags.size).toBe(0);
    expect(next.expandedConversations.size).toBe(0);
  });

  it("keeps the flow store across a same-brief render", () => {
    currentBriefId = "brief-a";
    const { result, rerender } = renderHook(
      () => useCreateReviewFlowStore(currentBriefId),
      { wrapper: Wrapper },
    );
    const first = result.current;
    act(() => {
      first.getState().actions.setReviewComment("kept text");
    });

    rerender();

    expect(result.current).toBe(first);
    expect(result.current.getState().reviewComment).toBe("kept text");
  });

  it("saves a comment into the switched brief's session", async () => {
    currentBriefId = "brief-a";
    const { result, rerender } = renderHook(useFlowAndSessionComments, {
      wrapper: Wrapper,
    });

    currentBriefId = "brief-b";
    rerender();
    await act(async () => {
      await result.current.flowStore
        .getState()
        .actions.saveComment(anchor, "on the new brief");
    });

    expect(
      result.current.sessionComments.map((comment) => comment.body),
    ).toEqual(["on the new brief"]);
    expect(result.current.sessionComments[0]?.status).toBe(
      ReviewCommentStatuses.DRAFT,
    );
  });
});
