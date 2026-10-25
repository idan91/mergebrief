// Wait-UX state machine matrix. Render trigger = artifact EXISTS, never
// status==="succeeded".
import { describe, expect, it } from "vitest";
import { WaitReasons } from "contract";
import {
  comparisonsWarming,
  deriveBriefRouteState,
  resolveMetaPollMs,
  selectBriefRouteState,
  shouldPollMeta,
} from "./briefRouteState";
import { resolveDbTimeline } from "./dbTimeline";
import type { GenerationSummary, PrSummary, RevisionSummary } from "../types";

function meta(overrides: Partial<PrSummary>): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "t",
    state: "open",
    headSha: "head-2",
    briefAvailable: false,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    viewerCanPush: false,
    appInstalled: true,
    behind: false,
    updatedAt: "2026-07-06T12:00:00.000Z",
    ...overrides,
  };
}

function generation(overrides: Partial<GenerationSummary>): GenerationSummary {
  return {
    status: "running",
    attempts: 0,
    updatedAt: "2026-07-06T12:00:00.000Z",
    ...overrides,
  };
}

describe("deriveBriefRouteState", () => {
  it("an explicit span always renders, an older-span deep link included", () => {
    const state = deriveBriefRouteState(
      meta({ briefAvailable: false, generation: generation({}) }),
      { base: "b1", head: "h1" },
    );
    expect(state).toEqual({ kind: "render", span: { base: "b1", head: "h1" } });
  });

  it("the current head degrades to the wait state while the first Brief runs", () => {
    // The Entry-comment "Brief is generating…" link points at the current
    // head whose artifact does not exist yet; rendering it would 404 the
    // page, so it degrades to the same diff-first wait a span-unknown load of a
    // generating PR produces.
    const state = deriveBriefRouteState(
      meta({
        briefAvailable: false,
        baseSha: "b2",
        headSha: "head-2",
        generation: generation({ status: "running", phase: "generating" }),
      }),
      { base: "b2", head: "head-2" },
    );
    expect(state).toEqual({
      kind: "waiting",
      status: "running",
      phase: "generating",
      span: { base: "b2", head: "head-2" },
    });
  });

  it("degrades on a matching head even when the explicit BASE drifts", () => {
    // The link's base comes from the generation task's fresh PR fetch, while
    // meta.baseSha falls back to the ingest-time row when no brief exists yet
    // and a drift between the two must not re-open the 404 (head is the
    // revision-selection key; base is a pinned convenience).
    const state = deriveBriefRouteState(
      meta({
        briefAvailable: false,
        baseSha: "b-ingest",
        headSha: "head-2",
        generation: generation({ status: "running", phase: "generating" }),
      }),
      { base: "b-fresh", head: "head-2" },
    );
    expect(state).toEqual({
      kind: "waiting",
      status: "running",
      phase: "generating",
      span: { base: "b-ingest", head: "head-2" },
    });
  });

  it("the current span STILL renders once its artifact exists", () => {
    const state = deriveBriefRouteState(
      meta({ briefAvailable: true, baseSha: "b2", headSha: "head-2" }),
      { base: "b2", head: "head-2" },
    );
    expect(state).toEqual({
      kind: "render",
      span: { base: "b2", head: "head-2" },
    });
  });

  it("a known span renders while generation runs: the artifact beats status", () => {
    const state = deriveBriefRouteState(
      meta({
        briefAvailable: true,
        baseSha: "b2",
        headSha: "head-2",
        generation: generation({ status: "running", phase: "delta-warmup" }),
      }),
      undefined,
    );
    expect(state).toEqual({
      kind: "render",
      span: { base: "b2", head: "head-2" },
    });
  });

  it("no generation row and no brief lands on the empty activation hint", () => {
    expect(deriveBriefRouteState(meta({}), undefined)).toEqual({
      kind: "empty",
    });
  });

  it("pending and running wait with phase; span undefined while base unknown", () => {
    const state = deriveBriefRouteState(
      meta({ generation: generation({ status: "pending" }) }),
      undefined,
    );
    expect(state).toMatchObject({
      kind: "waiting",
      status: "pending",
      span: undefined,
    });

    const running = deriveBriefRouteState(
      meta({
        generation: generation({ status: "running", phase: "generating" }),
      }),
      undefined,
    );
    expect(running).toMatchObject({ kind: "waiting", phase: "generating" });
  });

  it("a pending wait carries the wait reason the meta reports", () => {
    const state = deriveBriefRouteState(
      meta({
        generation: generation({
          status: "pending",
          waitReason: WaitReasons.WAITING_FOR_SLOT,
        }),
      }),
      undefined,
    );

    expect(state).toMatchObject({
      kind: "waiting",
      waitReason: WaitReasons.WAITING_FOR_SLOT,
    });
  });

  it("failed → failure code + sanitized detail + attempts", () => {
    const state = deriveBriefRouteState(
      meta({
        generation: generation({
          status: "failed",
          errorCode: "unknown",
          errorDetail: "boom",
          attempts: 2,
        }),
      }),
      undefined,
    );
    expect(state).toEqual({
      kind: "failed",
      errorCode: "unknown",
      errorDetail: "boom",
      attempts: 2,
    });
  });

  it("superseded stays superseded while the newer revision is coming", () => {
    const state = deriveBriefRouteState(
      meta({ generation: generation({ status: "superseded" }) }),
      undefined,
    );
    expect(state).toEqual({ kind: "superseded" });
  });

  it("capped carries the skip time and is never a fake failure", () => {
    const state = deriveBriefRouteState(
      meta({
        generation: generation({
          status: "capped",
          updatedAt: "2026-08-03T18:30:00.000Z",
        }),
      }),
      undefined,
    );
    expect(state).toEqual({
      kind: "capped",
      cappedAt: "2026-08-03T18:30:00.000Z",
    });
  });

  it("a status this bundle predates reads empty and ends the fast poll", () => {
    const unknown = meta({
      generation: generation({ status: "unknown" }),
      briefAvailable: false,
    });

    expect(deriveBriefRouteState(unknown, undefined)).toEqual({
      kind: "empty",
    });
    expect(shouldPollMeta(unknown)).toBe(false);
    expect(comparisonsWarming({ ...unknown, briefAvailable: true })).toBe(
      false,
    );
  });

  it("a closed installation PR's superseded row ends the fast poll", () => {
    const superseded = generation({ status: "superseded" });
    const closed = meta({ generation: superseded, state: "closed" });
    const closedUrlRow = { ...closed, appInstalled: false };

    expect(shouldPollMeta({ ...closed, appInstalled: true })).toBe(false);
    expect(shouldPollMeta(closedUrlRow)).toBe(true);
  });

  it("a skipped draft's superseded row ends the fast poll", () => {
    const superseded = generation({ status: "superseded" });
    const heldDraft = meta({
      generation: superseded,
      appInstalled: true,
      draft: true,
      draftPolicy: { generate: false },
    });

    expect(shouldPollMeta(heldDraft)).toBe(false);
  });

  it("an awaiting-trigger head reads its own state and ends the fast poll", () => {
    const awaiting = meta({
      generation: generation({ status: "awaiting-trigger" }),
      briefAvailable: false,
    });

    expect(deriveBriefRouteState(awaiting, undefined)).toEqual({
      kind: "awaiting-trigger",
    });
    expect(shouldPollMeta(awaiting)).toBe(false);
  });

  it("a null-base row with a brief at its head warms and settles", () => {
    const nullBase = { briefAvailable: false, headBriefStored: true };
    const running = meta({ ...nullBase, generation: generation({}) });
    const superseded = meta({
      ...nullBase,
      generation: generation({ status: "superseded" }),
    });

    expect(comparisonsWarming(running)).toBe(true);
    expect(shouldPollMeta(superseded)).toBe(false);
  });

  it("renders a null-base row's head brief over its failed rerun", () => {
    const failed = meta({
      briefAvailable: false,
      headBriefStored: true,
      baseSha: "base-a",
      generation: generation({ status: "failed" }),
    });

    expect(deriveBriefRouteState(failed, undefined)).toEqual({
      kind: "render",
      span: { base: "base-a", head: "head-2" },
    });
  });

  it("renders a link to a head whose brief sits on another base", () => {
    const running = meta({
      briefAvailable: false,
      headBriefStored: true,
      generation: generation({}),
    });
    const link = { base: "base-a", head: "head-2" };

    expect(deriveBriefRouteState(running, link)).toEqual({
      kind: "render",
      span: link,
    });
  });

  it("reads briefAvailable as any-base on a server without headBriefStored", () => {
    const legacy = meta({
      briefAvailable: true,
      generation: generation({ status: "running" }),
    });

    expect(comparisonsWarming(legacy)).toBe(true);
  });

  it("succeeded but artifact missing → empty, never an infinite wait", () => {
    const state = deriveBriefRouteState(
      meta({
        generation: generation({ status: "succeeded" }),
        briefAvailable: false,
      }),
      undefined,
    );
    expect(state).toEqual({ kind: "empty" });
  });
});

describe("shouldPollMeta", () => {
  it("polls while pending or running even once the brief renders", () => {
    expect(
      shouldPollMeta(meta({ generation: generation({ status: "pending" }) })),
    ).toBe(true);
    expect(
      shouldPollMeta(
        meta({
          briefAvailable: true,
          generation: generation({ status: "running" }),
        }),
      ),
    ).toBe(true);
  });

  it("polls a superseded row until its replacement's brief lands", () => {
    expect(
      shouldPollMeta(
        meta({ generation: generation({ status: "superseded" }) }),
      ),
    ).toBe(true);
    expect(
      shouldPollMeta(
        meta({
          briefAvailable: true,
          generation: generation({ status: "superseded" }),
        }),
      ),
    ).toBe(false);
  });

  it("never polls a capped row: the skip is terminal, nothing is coming", () => {
    expect(
      shouldPollMeta(meta({ generation: generation({ status: "capped" }) })),
    ).toBe(false);
  });

  it("polls the viewer's OWN draft: external ready flips must propagate", () => {
    // A fully settled generation on the author's own draft still polls, as
    // this is exactly the state an author sits in while self-reviewing, and
    // a ready-elsewhere flip (marked ready on GitHub) must reach a focused
    // tab without a window-focus refetch.
    expect(
      shouldPollMeta(
        meta({
          draft: true,
          viewerIsAuthor: true,
          briefAvailable: true,
          generation: generation({ status: "succeeded" }),
        }),
      ),
    ).toBe(true);
    // Someone ELSE's draft does not poll: no draft-keyed affordances there;
    // a flip INTO own-draft arrives via the focus refetch, as before.
    expect(
      shouldPollMeta(
        meta({
          draft: true,
          viewerIsAuthor: false,
          briefAvailable: true,
          generation: generation({ status: "succeeded" }),
        }),
      ),
    ).toBe(false);
    // The same settled meta without the draft flag does not poll either.
    expect(
      shouldPollMeta(
        meta({
          draft: false,
          viewerIsAuthor: true,
          briefAvailable: true,
          generation: generation({ status: "succeeded" }),
        }),
      ),
    ).toBe(false);
  });

  it("polls while lastReview is pending after the generation is terminal", () => {
    expect(
      shouldPollMeta(
        meta({
          briefAvailable: true,
          generation: generation({ status: "succeeded" }),
          comparisons: {
            lastReview: { kind: "unavailable", reason: "pending" },
          },
        }),
      ),
    ).toBe(true);
    // Other lastReview states never keep the poll alive on their own.
    expect(
      shouldPollMeta(
        meta({
          briefAvailable: true,
          generation: generation({ status: "succeeded" }),
          comparisons: {
            lastReview: {
              kind: "unavailable",
              reason: "baseline-unavailable",
            },
          },
        }),
      ),
    ).toBe(false);
    expect(
      shouldPollMeta(
        meta({
          briefAvailable: true,
          generation: generation({ status: "succeeded" }),
          comparisons: {
            lastReview: {
              kind: "available",
              deltaAvailable: true,
              baselineSha: "cp-1",
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it("off for terminal success/failure and for no generation", () => {
    expect(shouldPollMeta(meta({}))).toBe(false);
    expect(
      shouldPollMeta(meta({ generation: generation({ status: "succeeded" }) })),
    ).toBe(false);
    expect(
      shouldPollMeta(meta({ generation: generation({ status: "failed" }) })),
    ).toBe(false);
  });
});

describe("comparisonsWarming", () => {
  it("true only while the rendered brief's generation is still non-terminal", () => {
    expect(
      comparisonsWarming(
        meta({
          briefAvailable: true,
          generation: generation({ status: "running" }),
        }),
      ),
    ).toBe(true);
    expect(
      comparisonsWarming(
        meta({
          briefAvailable: true,
          generation: generation({ status: "succeeded" }),
        }),
      ),
    ).toBe(false);
    expect(
      comparisonsWarming(
        meta({ generation: generation({ status: "running" }) }),
      ),
    ).toBe(false);
  });
});

describe("resolveMetaPollMs", () => {
  it("re-reads every four seconds while a generation is in flight", () => {
    expect(
      resolveMetaPollMs(
        meta({ generation: generation({ status: "running" }) }),
      ),
    ).toBe(4_000);
  });

  it("keeps a thirty second poll once nothing is in flight", () => {
    expect(
      resolveMetaPollMs(
        meta({
          briefAvailable: true,
          generation: generation({ status: "succeeded" }),
        }),
      ),
    ).toBe(30_000);
  });
});

describe("selectBriefRouteState", () => {
  const storedRevision: RevisionSummary = {
    headSha: "head-1",
    baseSha: "base-1",
    headIndex: 1,
    createdAt: "2026-07-06T12:00:00.000Z",
    comparisons: {},
  };
  const newerHeadPending = meta({
    headSha: "head-2",
    briefAvailable: false,
    generation: generation({ status: "pending" }),
    revisions: [storedRevision],
  });

  it("keeps the stored brief on screen while a newer head generates", () => {
    const timeline = resolveDbTimeline(newerHeadPending.revisions, {});

    expect(
      selectBriefRouteState(newerHeadPending, timeline, {
        explicitSpan: undefined,
      }),
    ).toEqual({ kind: "render", span: { base: "base-1", head: "head-1" } });
  });

  it("waits when a link names the head that is still generating", () => {
    const explicit = { base: "base-2", head: "head-2" };
    const timeline = resolveDbTimeline(newerHeadPending.revisions, explicit);

    expect(
      selectBriefRouteState(newerHeadPending, timeline, {
        explicitSpan: explicit,
      }),
    ).toMatchObject({ kind: "waiting", status: "pending" });
  });

  it("renders a stored span whose head is generating again on a new base", () => {
    const reset = meta({
      headSha: "head-1",
      briefAvailable: false,
      generation: generation({ status: "pending" }),
      revisions: [
        storedRevision,
        { ...storedRevision, headSha: "head-2", headIndex: 2 },
      ],
    });
    const stored = { base: "base-1", head: "head-1" };
    const generating = { base: "base-3", head: "head-1" };

    expect(
      selectBriefRouteState(reset, resolveDbTimeline(reset.revisions, stored), {
        explicitSpan: stored,
      }),
    ).toEqual({ kind: "render", span: stored });
    expect(
      selectBriefRouteState(
        reset,
        resolveDbTimeline(reset.revisions, generating),
        { explicitSpan: generating },
      ),
    ).toMatchObject({ kind: "waiting" });
  });

  it("keeps the stored brief up while the latest push awaits its trigger", () => {
    const gated = meta({
      ...newerHeadPending,
      generation: generation({ status: "awaiting-trigger" }),
    });
    const timeline = resolveDbTimeline(gated.revisions, {});

    expect(
      selectBriefRouteState(gated, timeline, { explicitSpan: undefined }),
    ).toEqual({ kind: "render", span: { base: "base-1", head: "head-1" } });
  });

  it("shows the awaiting card when the Entry links the gated push's rev", () => {
    const gated = meta({
      ...newerHeadPending,
      generation: generation({ status: "awaiting-trigger" }),
    });
    const timeline = resolveDbTimeline(gated.revisions, { rev: 2 });

    expect(
      selectBriefRouteState(gated, timeline, {
        explicitSpan: undefined,
        rev: 2,
      }),
    ).toEqual({ kind: "awaiting-trigger" });
  });

  it("shows the awaiting card when a link names the gated push", () => {
    const gated = meta({
      ...newerHeadPending,
      generation: generation({ status: "awaiting-trigger" }),
    });
    const explicit = { base: "base-2", head: "head-2" };
    const timeline = resolveDbTimeline(gated.revisions, explicit);

    expect(
      selectBriefRouteState(gated, timeline, { explicitSpan: explicit }),
    ).toEqual({ kind: "awaiting-trigger" });
  });

  it("waits when a link names the next revision that is still generating", () => {
    const timeline = resolveDbTimeline(newerHeadPending.revisions, { rev: 2 });

    expect(
      selectBriefRouteState(newerHeadPending, timeline, {
        explicitSpan: undefined,
        rev: 2,
      }),
    ).toMatchObject({ kind: "waiting", status: "pending" });
  });

  const newerHeadFailed = meta({
    ...newerHeadPending,
    generation: generation({
      status: "failed",
      errorCode: "provider-timeout",
      attempts: 1,
    }),
  });

  it("keeps the stored brief up while the latest push failed", () => {
    const timeline = resolveDbTimeline(newerHeadFailed.revisions, {});

    expect(
      selectBriefRouteState(newerHeadFailed, timeline, {
        explicitSpan: undefined,
      }),
    ).toEqual({ kind: "render", span: { base: "base-1", head: "head-1" } });
  });

  it("shows the failed card when the Entry links the failed push's rev", () => {
    const timeline = resolveDbTimeline(newerHeadFailed.revisions, { rev: 2 });

    expect(
      selectBriefRouteState(newerHeadFailed, timeline, {
        explicitSpan: undefined,
        rev: 2,
      }),
    ).toEqual({
      kind: "failed",
      errorCode: "provider-timeout",
      errorDetail: undefined,
      attempts: 1,
    });
  });
});
