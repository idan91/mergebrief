// @vitest-environment jsdom
// The in-place brief switch: the provider is no longer remounted per brief
// (the subtree key is gone), so swapping `briefId`+`model` must re-derive the
// store from the NEW model and the NEW brief's session. Chunk/flag ids collide
// across briefs by construction (positional c1..cN), so a missed reset
// silently reads as the wrong brief's session — every pin here uses colliding
// ids on purpose.
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Brief } from "../../brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import { ReviewSessionProvider, useReviewSession } from ".";
import type { ReviewSessionPayload } from "./serverState";

afterEach(cleanup);

/** An otherwise-empty session carrying one read mark. */
function sessionWithReadMark(chunkId: string): ReviewSessionPayload {
  return {
    materialized: false,
    carriedFrom: null,
    attention: [],
    reviewOutcome: "comment",
    draftComments: [],
    readMarks: [chunkId],
    reclassifications: [],
    dispositions: [],
    submittedReviewIds: [],
  };
}

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
let currentSession: ReviewSessionPayload | undefined = undefined;

function Wrapper({ children }: { children?: ReactNode }) {
  return (
    <ReviewSessionProvider
      briefId={currentBriefId}
      model={currentBriefId === "brief-a" ? modelA : modelB}
      session={currentSession}
    >
      {children}
    </ReviewSessionProvider>
  );
}

function renderSession(initial?: ReviewSessionPayload) {
  currentBriefId = "brief-a";
  currentSession = initial;
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
    rerenderWith: (next: ReviewSessionPayload) => {
      currentSession = next;
      utils.rerender();
    },
    switchTo: (briefId: string, next?: ReviewSessionPayload) => {
      currentBriefId = briefId;
      currentSession = next;
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

  it("takes the NEW brief's session on switch, never the old brief's", () => {
    const { result, switchTo } = renderSession(sessionWithReadMark("c1"));
    expect(result.current.reviewedChunks.has("c1")).toBe(true);

    // B's own session is empty — A's mark must not survive the switch.
    switchTo("brief-b");
    expect(result.current.reviewedChunks.has("c1")).toBe(false);

    // Back on A, with A's session again: the mark returns from the server's
    // copy, not from anything the client kept.
    switchTo("brief-a", sessionWithReadMark("c1"));
    expect(result.current.reviewedChunks.has("c1")).toBe(true);
  });

  it("a session that lands after the first paint still reaches the store", () => {
    // The degraded route recovering: writes come back on when the payload
    // arrives, so the work it carries has to arrive with them.
    const { result, rerenderWith } = renderSession();
    expect(result.current.reviewedChunks.has("c1")).toBe(false);
    rerenderWith(sessionWithReadMark("c1"));
    expect(result.current.reviewedChunks.has("c1")).toBe(true);
  });

  it("writes nothing to sessionStorage", () => {
    const { result, switchTo } = renderSession();
    act(() => {
      result.current.actions.reviewChunk("c1");
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    switchTo("brief-b");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(window.sessionStorage.length).toBe(0);
  });
});
