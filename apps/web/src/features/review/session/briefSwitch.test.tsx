// @vitest-environment jsdom
// The in-place brief switch: the provider is no longer remounted per brief
// (the subtree key is gone), so swapping `briefId`+`model` must do everything
// the unmount used to do — flush the old brief's pending persist write under
// the OLD id, re-derive the store from the NEW model, and hydrate the new
// brief's own snapshot. Chunk/flag ids collide across briefs by construction
// (positional c1..cN), so a missed reset silently reads as the wrong brief's
// session — every pin here uses colliding ids on purpose.
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Brief } from "../../brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import { ReviewSessionProvider, useReviewSession } from ".";
import { readSnapshot } from "./snapshot";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function makeBrief(sha: string, file: string): Brief {
  return {
    artifactKind: "brief",
    pr: {
      repo: "acme/widgets",
      number: 7,
      title: "t",
      url: "https://example.com/pr/7",
      sha,
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
    // Same chunk id in both briefs — the id-collision hazard under test.
    chunks: [
      {
        id: "c1",
        changeGroupId: "g1",
        file,
        concern: "implementation",
        role: "core",
        loc: { added: 1, deleted: 0 },
        addedRanges: [],
        removedRanges: [],
        riskSurface: ["hot-path"],
        diff: [{ kind: "add", content: "x();", newLine: 11 }],
      },
    ],
    concernView: [],
  };
}

const briefA = makeBrief("aaaa1111", "src/a.ts");
const briefB = makeBrief("bbbb2222", "src/b.ts");
const modelA = buildBriefViewModel(briefA);
const modelB = buildBriefViewModel(briefB);

// renderHook's `wrapper` receives only children (initialProps go to the hook
// callback), so the provider's briefId is driven through this holder and
// switched via `switchTo` below.
let currentBriefId = "brief-a";

function Wrapper({ children }: { children?: ReactNode }) {
  return (
    <ReviewSessionProvider
      briefId={currentBriefId}
      model={currentBriefId === "brief-a" ? modelA : modelB}
    >
      {children}
    </ReviewSessionProvider>
  );
}

function renderSession() {
  currentBriefId = "brief-a";
  const utils = renderHook(
    // Field-wise selectors: an object-literal selector would return a fresh
    // reference per call and loop useSyncExternalStore.
    () => ({
      reviewedChunks: useReviewSession((state) => state.reviewedChunks),
      reviewComments: useReviewSession((state) => state.reviewComments),
      dispositions: useReviewSession((state) => state.dispositions),
      actions: useReviewSession((state) => state.actions),
    }),
    { wrapper: Wrapper },
  );
  return {
    ...utils,
    switchTo: (briefId: string) => {
      currentBriefId = briefId;
      utils.rerender();
    },
  };
}

describe("in-place brief switch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-derives the session for the new brief even with colliding ids", () => {
    const { result, switchTo } = renderSession();
    act(() => {
      result.current.actions.reviewChunk("c1");
    });
    expect(result.current.reviewedChunks.has("c1")).toBe(true);

    switchTo("brief-b");
    // Same chunk id exists in B — the reset must still clear it: it was A's.
    expect(result.current.reviewedChunks.has("c1")).toBe(false);
    expect(result.current.reviewComments).toEqual([]);
    // Dispositions re-derived from B's model, not carried from A.
    expect(Object.keys(result.current.dispositions)).toEqual(
      modelB.flags.map((flag) => flag.id),
    );
  });

  it("flushes the old brief's pending write under the OLD id on switch", () => {
    const { result, switchTo } = renderSession();
    act(() => {
      result.current.actions.reviewChunk("c1");
    });
    // Still inside the debounce window — nothing persisted yet.
    expect(readSnapshot("brief-a")).toBeUndefined();

    switchTo("brief-b");
    const flushed = readSnapshot("brief-a");
    expect(flushed?.reviewedChunkIds).toEqual(["c1"]);
    // And nothing was written under B's id by the flush.
    expect(readSnapshot("brief-b")).toBeUndefined();
  });

  it("hydrates the NEW brief's snapshot after the switch", () => {
    const { result, switchTo } = renderSession();
    // Visit B once, review a chunk, let the debounce persist it.
    switchTo("brief-b");
    act(() => {
      result.current.actions.reviewChunk("c1");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(readSnapshot("brief-b")?.reviewedChunkIds).toEqual(["c1"]);

    // Away and back: B's own session returns; it is not A's empty state.
    switchTo("brief-a");
    expect(result.current.reviewedChunks.has("c1")).toBe(false);
    switchTo("brief-b");
    expect(result.current.reviewedChunks.has("c1")).toBe(true);
  });

  it("persists post-switch edits under the NEW id only", () => {
    const { result, switchTo } = renderSession();
    switchTo("brief-b");
    act(() => {
      result.current.actions.reviewChunk("c1");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(readSnapshot("brief-b")?.reviewedChunkIds).toEqual(["c1"]);
    expect(readSnapshot("brief-a")).toBeUndefined();
  });
});
