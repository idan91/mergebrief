// @vitest-environment jsdom
// The rendered-brief plan assembly: identity pinning (commit_id = the RENDERED
// span's head, never meta.headSha), own-draft affordance gating, and
// comparison-availability scoping.
import {
  QueryClient,
  QueryClientProvider,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type * as PostCommentModule from "../transport/postComment";

import { buildPrMetaQueryOptions } from "../queries";
import type { Span } from "../utils/briefRouteState";
import { resolveDbTimeline } from "../utils/dbTimeline";
import type { PrComparisons, PrSummary } from "../types";
import { usePrBriefPlans } from "./usePrBriefPlans";

vi.mock("../transport/submitReview", () => ({ submitReview: vi.fn() }));
vi.mock("../../conversation/resolve", () => ({
  setThreadResolution: vi.fn(async () => ({
    kind: "done",
    resolved: true,
    alreadyInTargetState: false,
  })),
}));
vi.mock("../transport/postComment", async (importOriginal) => ({
  ...(await importOriginal<typeof PostCommentModule>()),
  postInlineComment: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

/** A wrapper over a CALLER-OWNED client, so invalidations are observable. */
function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
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
    viewerCanResolve: false,
    appInstalled: true,
    behind: false,
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

describe("usePrBriefPlans", () => {
  it("keys the session store like a local brief id", () => {
    const { result } = renderPlans({});
    expect(result.current.briefId).toBe("db:424242:7:base-2:head-2");
  });

  it("names the RENDERED span on the submit write, never meta's head", async () => {
    const { submitReview } = vi.mocked(
      await import("../transport/submitReview"),
    );
    const { result } = renderPlans({ span: historicalSpan });
    void result.current.submitAction({ outcome: "comment", body: "signature" });
    expect(submitReview.mock.calls[0]?.[2]).toMatchObject({ head: "head-1" });
    expect(submitReview.mock.calls[0]?.[3]).toEqual({
      outcome: "comment",
      body: "signature",
    });
  });

  it("posts a draft BY ID against the rendered span", async () => {
    const { postInlineComment } = vi.mocked(
      await import("../transport/postComment"),
    );
    const { result } = renderPlans({
      meta: meta({ draft: true, viewerIsAuthor: true }),
    });
    void result.current.ownDraft?.postComment?.("9001");
    expect(postInlineComment).toHaveBeenCalledWith(
      "424242",
      7,
      expect.objectContaining({ head: "head-2" }),
      { draftId: "9001" },
    );
  });

  describe("own-draft gating", () => {
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

    it("offers the meta comparisons at the current head on the legacy path", () => {
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

    describe.each(["meta", "timeline"] as const)(
      "polled %s envelope",
      (source) => {
        // Every tick serves freshly parsed objects; only the query layer can
        // hand the hook the envelope identities it held before.
        async function renderPolledPlans(
          serveTick: (tick: number) => PrComparisons,
        ) {
          const client = new QueryClient();
          let tick = 0;
          const options = {
            ...buildPrMetaQueryOptions("424242", 7),
            queryFn: async (): Promise<PrSummary> => {
              const served = structuredClone(serveTick(tick));
              tick += 1;
              return meta({
                updatedAt: `2026-07-06T12:00:0${String(tick)}.000Z`,
                comparisons: served,
                revisions: [
                  {
                    headSha: "head-2",
                    baseSha: "base-2",
                    headIndex: 2,
                    createdAt: "2026-07-06T12:00:00.000Z",
                    comparisons: served,
                  },
                ],
              });
            },
          };
          await client.ensureQueryData(options);
          const rendered = renderHook(
            () => {
              const polled = useSuspenseQuery(options).data;
              const timeline =
                source === "timeline"
                  ? resolveDbTimeline(polled.revisions, {})
                  : undefined;
              const plans = usePrBriefPlans({
                repoId: "424242",
                prNumber: 7,
                span: currentSpan,
                meta: polled,
                timeline,
                revisionJump: undefined,
              });
              return { meta: polled, plans };
            },
            { wrapper: wrapperWith(client) },
          );
          async function poll() {
            const before = rendered.result.current.meta;
            await act(() =>
              client.refetchQueries({ queryKey: options.queryKey }),
            );
            await waitFor(() => {
              expect(rendered.result.current.meta).not.toBe(before);
            });
          }
          return { result: rendered.result, poll };
        }

        it("keeps the plan's identity across poll ticks with equal envelopes", async () => {
          const { result, poll } = await renderPolledPlans(() => comparisons);
          const first = result.current.plans.comparisonPlan;
          await poll();
          expect(result.current.plans.comparisonPlan).toBe(first);
        });

        it("rebuilds the plan when a tick changes a field the plan reads", async () => {
          const { result, poll } = await renderPolledPlans((tick) => {
            if (tick === 0) {
              return comparisons;
            }
            return {
              ...comparisons,
              previousBrief: {
                baselineSha: "head-1",
                baselineIndex: 1,
                narrativeAvailable: false,
              },
            };
          });
          const first = result.current.plans.comparisonPlan;
          expect(first.previousBrief?.narrative).toBeDefined();
          await poll();
          expect(result.current.plans.comparisonPlan).not.toBe(first);
          expect(
            result.current.plans.comparisonPlan.previousBrief?.narrative,
          ).toBeUndefined();
        });
      },
    );

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

  it("names the repo mentions search on the conversation plan", () => {
    expect(renderPlans({}).result.current.conversationPlan.mentionRepoId).toBe(
      "424242",
    );
  });

  describe("thread resolution", () => {
    it("carries the PR-META capability onto the conversation plan", () => {
      expect(
        renderPlans({}).result.current.conversationPlan.resolution?.canResolve,
      ).toBe(false);
      expect(
        renderPlans({ meta: meta({ viewerCanResolve: true }) }).result.current
          .conversationPlan.resolution?.canResolve,
      ).toBe(true);
    });

    it("routes the transport at this repo + PR, in the requested direction", async () => {
      const { setThreadResolution } = vi.mocked(
        await import("../../conversation/resolve"),
      );
      const { result } = renderPlans({
        meta: meta({ viewerCanResolve: true }),
      });
      void result.current.conversationPlan.resolution?.setResolved(9001, false);
      expect(setThreadResolution).toHaveBeenCalledWith(
        "424242",
        7,
        9001,
        false,
      );
    });

    it("refetches PR META when the capability goes stale on a 403", () => {
      const client = new QueryClient();
      const invalidate = vi.spyOn(client, "invalidateQueries");
      const { result } = renderHook(
        () =>
          usePrBriefPlans({
            repoId: "424242",
            prNumber: 7,
            span: currentSpan,
            meta: meta({ viewerCanResolve: true }),
            timeline: undefined,
            revisionJump: undefined,
          }),
        { wrapper: wrapperWith(client) },
      );
      result.current.conversationPlan.resolution?.refetchCapability();
      // The capability lives on pr-meta: refreshing it is what makes the
      // buttons follow GitHub's answer instead of the boolean that offered them.
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["pr-meta", "424242", 7],
      });
    });

    it("is offered on a historical revision too; threads are PR-level", () => {
      const { result } = renderPlans({
        span: historicalSpan,
        meta: meta({ viewerCanResolve: true }),
      });
      expect(result.current.conversationPlan.resolution?.canResolve).toBe(true);
    });
  });
});
