// @vitest-environment jsdom
// The flow store's in-place brief switch: its ephemeral half (composer
// anchor, dismiss/evidence targets, submit note, flag selection, toast) is
// anchored to the old brief's ids and must clear when briefId swaps without
// a remount. The posture half re-syncs separately and is not under test.
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { Brief } from "../../../brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import { ReviewSessionProvider } from "..";
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

const POSTURE = {
  composerDisabledReason: undefined,
  flagsReadOnly: false,
  postingCommentIds: new Set<string>(),
  postBlockedExternally: undefined,
  postComment: undefined,
};

describe("flow store in-place brief switch", () => {
  it("clears the ephemeral half when briefId changes", () => {
    currentBriefId = "brief-a";
    const { result, rerender } = renderHook(
      () => useCreateReviewFlowStore(currentBriefId, POSTURE),
      { wrapper: Wrapper },
    );
    const store = result.current;
    act(() => {
      store.getState().actions.setReviewComment("carried text");
      store.getState().actions.toggleConversationThread("src/a.ts#c1", 9001);
      store.setState({ toast: "old toast", liveMessage: "old line" });
    });
    expect(store.getState().reviewComment).toBe("carried text");

    currentBriefId = "brief-b";
    rerender();
    expect(store.getState().reviewComment).toBe("");
    expect(store.getState().toast).toBe("");
    expect(store.getState().liveMessage).toBe("");
    expect(store.getState().composerAnchor).toBeNull();
    expect(store.getState().dismissTarget).toBeNull();
    expect(store.getState().evidenceTarget).toBeNull();
    expect(store.getState().selectedRiskFlags.size).toBe(0);
    expect(store.getState().expandedConversations.size).toBe(0);
  });
});
