// @vitest-environment jsdom
// First direct coverage for the rendered-brief plan assembly: identity
// pinning (commit_id = the RENDERED span's head, never meta.headSha),
// own-draft affordance gating, and comparison-availability scoping.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type * as PostCommentModule from "../postComment";

import type { CommentAnchor } from "../../review/comments";
import type { Span } from "../briefRouteState";
import type { PrSummary } from "../types";
import { usePrBriefPlans } from "./usePrBriefPlans";

vi.mock("../submitReview", () => ({ submitReview: vi.fn() }));
vi.mock("../postComment", async (importOriginal) => ({
  ...(await importOriginal<typeof PostCommentModule>()),
  postInlineComment: vi.fn(),
}));

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function meta(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "t",
    state: "open",
    baseSha: "base-2",
    headSha: "head-2",
    briefAvailable: true,
    draft: false,
    viewerIsAuthor: false,
    generation: null,
    updatedAt: "2026-07-06T12:00:00.000Z",
    ...overrides,
  };
}

const currentSpan: Span = { base: "base-2", head: "head-2" };
const historicalSpan: Span = { base: "base-1", head: "head-1" };

function renderPlans(overrides: {
  span?: Span;
  meta?: PrSummary;
  timeline?: Parameters<typeof usePrBriefPlans>[0]["timeline"];
}) {
  return renderHook(
    () =>
      usePrBriefPlans({
        repoId: "424242",
        prNumber: 7,
        span: overrides.span ?? currentSpan,
        meta: overrides.meta ?? meta(),
        timeline: overrides.timeline,
        revisionJump: undefined,
      }),
    { wrapper },
  );
}

const anchor: CommentAnchor = {
  chunkId: "c1",
  file: "src/a.ts",
  side: "new",
  startLine: 10,
  endLine: 10,
  rowIds: ["c1:1"],
  selectedText: "b",
};

describe("usePrBriefPlans", () => {
  it("keys the session store like a local brief id", () => {
    const { result } = renderPlans({});
    expect(result.current.briefId).toBe("db:424242:7:base-2:head-2");
  });

  it("pins the submit commit_id to the RENDERED span's head, never meta's", async () => {
    const { submitReview } = vi.mocked(await import("../submitReview"));
    const { result } = renderPlans({ span: historicalSpan });
    void result.current.submitAction({
      outcome: "comment",
      body: "signature",
      comments: [],
    });
    const payload = submitReview.mock.calls[0]?.[2];
    expect(payload).toMatchObject({ commitId: "head-1" });
  });

  it("pins the post-now commit_id to the rendered span's head", async () => {
    const { postInlineComment } = vi.mocked(await import("../postComment"));
    const { result } = renderPlans({
      meta: meta({ draft: true, viewerIsAuthor: true }),
    });
    void result.current.ownDraft?.postComment?.(anchor, "a body");
    expect(postInlineComment).toHaveBeenCalledWith(
      "424242",
      7,
      expect.objectContaining({ commitId: "head-2", body: "a body" }),
    );
  });

  describe("own-draft gating (BRIEF-43)", () => {
    it("absent on any non-own-draft view", () => {
      const { result } = renderPlans({});
      expect(result.current.ownDraft).toBeUndefined();
    });

    it("carries the actions at the current head", () => {
      const { result } = renderPlans({
        meta: meta({ draft: true, viewerIsAuthor: true }),
      });
      expect(result.current.ownDraft?.markReady).toBeDefined();
      expect(result.current.ownDraft?.postComment).toBeDefined();
    });

    it("keeps the STATE but drops the actions off the current head", () => {
      const { result } = renderPlans({
        span: historicalSpan,
        meta: meta({ draft: true, viewerIsAuthor: true }),
      });
      expect(result.current.ownDraft).toEqual({});
    });
  });

  describe("comparison scoping", () => {
    const comparisons: PrSummary["comparisons"] = {
      previousBrief: {
        baselineSha: "head-1",
        baselineIndex: 1,
        narrativeAvailable: true,
      },
      lastReview: {
        kind: "available",
        baselineSha: "cp-1",
        deltaAvailable: false,
      },
    };

    it("offers the meta comparisons at the current head (legacy path)", () => {
      const { result } = renderPlans({ meta: meta({ comparisons }) });
      expect(result.current.availability).toEqual({
        previousBrief: true,
        lastReview: true,
      });
      expect(
        result.current.comparisonPlan.previousBrief?.narrative,
      ).toBeDefined();
      // Marks-only tier: no delta descriptor.
      expect(result.current.comparisonPlan.lastReview?.delta).toBeUndefined();
    });

    it("a pinned older span must not borrow the current head's baselines", () => {
      const { result } = renderPlans({
        span: historicalSpan,
        meta: meta({ comparisons }),
      });
      expect(result.current.availability).toEqual({
        previousBrief: false,
        lastReview: false,
      });
    });

    it("keeps the plan's identity across poll ticks that rebuild equal envelopes", () => {
      const { result, rerender } = renderHook(
        ({ tick }: { tick: number }) =>
          usePrBriefPlans({
            repoId: "424242",
            prNumber: 7,
            span: currentSpan,
            // A poll tick rebuilds the meta (and its comparisons envelope)
            // with unchanged content — fresh identities, same values.
            meta: meta({
              comparisons: structuredClone(comparisons),
              updatedAt: `2026-07-06T12:00:0${String(tick)}.000Z`,
            }),
            timeline: undefined,
            revisionJump: undefined,
          }),
        { wrapper, initialProps: { tick: 0 } },
      );
      const first = result.current.comparisonPlan;
      rerender({ tick: 1 });
      expect(result.current.comparisonPlan).toBe(first);
    });

    it("an unavailable checkpoint surfaces its honest reason, not a plan", () => {
      const { result } = renderPlans({
        meta: meta({
          comparisons: {
            lastReview: { kind: "unavailable", reason: "pending" },
          },
        }),
      });
      expect(result.current.availability.lastReview).toBe(false);
      expect(result.current.lastReviewDisabledReason).toBeDefined();
    });
  });
});
