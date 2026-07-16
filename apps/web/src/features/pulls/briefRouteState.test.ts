// Wait-UX state machine matrix (BRIEF-19 PR 3.2 — reviewed as the risky core
// of the route). Render trigger = artifact EXISTS, never status==="succeeded".
import { describe, expect, it } from "vitest";
import {
  comparisonsWarming,
  deriveBriefRouteState,
  headAdvanced,
  shouldPollMeta,
} from "./briefRouteState";
import type { GenerationSummary, PrSummary } from "./types";

function meta(overrides: Partial<PrSummary>): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "t",
    state: "open",
    baseSha: null,
    headSha: "head-2",
    briefAvailable: false,
    draft: false,
    viewerIsAuthor: false,
    generation: null,
    updatedAt: "2026-07-06T12:00:00.000Z",
    ...overrides,
  };
}

function generation(overrides: Partial<GenerationSummary>): GenerationSummary {
  return {
    status: "running",
    phase: null,
    attempts: 0,
    error: null,
    updatedAt: "2026-07-06T12:00:00.000Z",
    ...overrides,
  };
}

describe("deriveBriefRouteState", () => {
  it("an explicit span always renders (deep link to an older span included)", () => {
    const state = deriveBriefRouteState(
      meta({ briefAvailable: false, generation: generation({}) }),
      { base: "b1", head: "h1" },
    );
    expect(state).toEqual({ kind: "render", span: { base: "b1", head: "h1" } });
  });

  it("an explicit span naming the CURRENT head degrades to the wait state while its first Brief is still generating (no 404)", () => {
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

  it("degrades on a matching head even when the explicit BASE mismatches the meta's (base drift must not veto)", () => {
    // The link's base comes from the generation task's fresh PR fetch, while
    // meta.baseSha falls back to the ingest-time row when no brief exists yet
    // — a drift between the two must not re-open the 404 (head is the
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

  it("an explicit span naming the current span STILL renders once its artifact exists", () => {
    const state = deriveBriefRouteState(
      meta({ briefAvailable: true, baseSha: "b2", headSha: "head-2" }),
      { base: "b2", head: "head-2" },
    );
    expect(state).toEqual({
      kind: "render",
      span: { base: "b2", head: "head-2" },
    });
  });

  it("briefAvailable + known span renders even while generation still runs (artifact EXISTS beats status)", () => {
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

  it("no generation row and no brief → empty (activation hint)", () => {
    expect(deriveBriefRouteState(meta({}), undefined)).toEqual({
      kind: "empty",
    });
  });

  it("queued/running → waiting with phase; span undefined while base unknown", () => {
    const state = deriveBriefRouteState(
      meta({ generation: generation({ status: "queued" }) }),
      undefined,
    );
    expect(state).toMatchObject({
      kind: "waiting",
      status: "queued",
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

  it("failed → sanitized error + attempts", () => {
    const state = deriveBriefRouteState(
      meta({
        generation: generation({
          status: "failed",
          error: "boom",
          attempts: 2,
        }),
      }),
      undefined,
    );
    expect(state).toEqual({ kind: "failed", error: "boom", attempts: 2 });
  });

  it("superseded → superseded (newer revision coming)", () => {
    const state = deriveBriefRouteState(
      meta({ generation: generation({ status: "superseded" }) }),
      undefined,
    );
    expect(state).toEqual({ kind: "superseded" });
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
  it("polls while queued/running (even when the brief already renders — warming chip)", () => {
    expect(
      shouldPollMeta(meta({ generation: generation({ status: "queued" }) })),
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

  it("polls the viewer's OWN draft (BRIEF-43): external ready flips must propagate", () => {
    // A fully settled generation on the author's own draft still polls —
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
    // Someone ELSE's draft does not poll — no draft-keyed affordances there;
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

  it("polls while lastReview is pending even after the brief generation is terminal (codex PR-46 finding)", () => {
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

describe("headAdvanced", () => {
  it("flags a pinned span once the meta's head moves past it", () => {
    const pinned = { base: "b1", head: "head-1" };
    expect(headAdvanced(meta({ headSha: "head-2" }), pinned)).toBe(true);
    expect(headAdvanced(meta({ headSha: "head-1" }), pinned)).toBe(false);
    expect(headAdvanced(meta({ headSha: null }), pinned)).toBe(false);
  });
});
