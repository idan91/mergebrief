// The DB-brief route's wait-UX state machine (BRIEF-19 PR 3.2), kept PURE so
// the whole map is unit-testable. Render trigger = brief artifact EXISTS for
// the resolved span (ADR 0006 #10) — NEVER `status === "succeeded"`
// (markSucceeded fires only after delta warmup, well after the artifact is
// readable). Generation status drives the waiting/failed/superseded display
// and the polling cadence only.
import { isOwnDraft } from "./ownDraft";
import type { PrSummary } from "./types";

export interface Span {
  readonly base: string;
  readonly head: string;
}

/** URL-carried explicit span (deep link / pinned view), if any. */
export type ExplicitSpan = Span | undefined;

export type BriefRouteState =
  /** A brief for `span` should be fetched and rendered. */
  | { readonly kind: "render"; readonly span: Span }
  /** Nothing was ever projected — show the activation hint (ADR 0020). */
  | { readonly kind: "empty" }
  /** Generation in flight — diff-first wait when the span is known. */
  | {
      readonly kind: "waiting";
      readonly status: "queued" | "running";
      readonly phase: string | null;
      readonly span: Span | undefined;
    }
  /** Terminal failure — sanitized error + attempts. */
  | {
      readonly kind: "failed";
      readonly error: string | null;
      readonly attempts: number;
    }
  /** Aborted because the head advanced — a newer brief is on the way. */
  | { readonly kind: "superseded" };

function metaSpan(meta: PrSummary): Span | undefined {
  if (meta.baseSha === null || meta.headSha === null) return undefined;
  return { base: meta.baseSha, head: meta.headSha };
}

/**
 * Derive what the route shows. An explicit span always renders (a deep link
 * to an older span shows that brief; a missing artifact surfaces as the brief
 * query's 404, not as a wait state). Otherwise the CURRENT span renders
 * exactly when its artifact exists; the generation summary picks the wait
 * flavor for everything else.
 */
export function deriveBriefRouteState(
  meta: PrSummary,
  explicitSpan: ExplicitSpan,
): BriefRouteState {
  if (explicitSpan !== undefined) {
    return { kind: "render", span: explicitSpan };
  }
  const span = metaSpan(meta);
  if (meta.briefAvailable && span !== undefined) {
    return { kind: "render", span };
  }
  const generation = meta.generation;
  if (generation === null) {
    return { kind: "empty" };
  }
  switch (generation.status) {
    case "queued":
    case "running":
      return {
        kind: "waiting",
        status: generation.status,
        phase: generation.phase,
        span,
      };
    case "failed":
      return {
        kind: "failed",
        error: generation.error,
        attempts: generation.attempts,
      };
    case "superseded":
      return { kind: "superseded" };
    case "succeeded":
      // Succeeded but the artifact for its head is not readable — a rare
      // inconsistency (e.g. artifact purged). Not a failure and nothing is
      // coming; fall back to the empty/activation state.
      return { kind: "empty" };
  }
}

/**
 * Poll the PR-meta while something is (or may be) in flight: a non-terminal
 * generation, a superseded row (its replacement is queued momentarily —
 * ADR 0006 #6), a rendered brief whose generation is still finishing (the
 * "comparisons warming" chip clears on the terminal refetch), or the
 * viewer's OWN DRAFT (BRIEF-43): the draft flag can flip externally at any
 * moment (marked ready on GitHub) and the own-draft affordances key on it —
 * a settled draft would otherwise never refetch, so a ready-elsewhere flip
 * would only propagate on a window-focus refetch. Scoped to the author:
 * other viewers of a draft carry no draft-keyed affordances, so for them the
 * focus refetch stays good enough — no poll cost across every open draft.
 */
export function shouldPollMeta(meta: PrSummary): boolean {
  if (isOwnDraft(meta)) return true;
  const status = meta.generation?.status;
  if (status === "queued" || status === "running") return true;
  if (status === "superseded" && !meta.briefAvailable) return true;
  // A pending lastReview comparison is also in-flight work (its delta may
  // finish after the brief generation is terminal — codex PR-46 finding):
  // keep polling so the disabled Compare control flips without a manual
  // refresh.
  return (
    meta.comparisons?.lastReview?.kind === "unavailable" &&
    meta.comparisons.lastReview.reason === "pending"
  );
}

/**
 * The rendered brief is current but its pipeline is still running (delta/
 * comparison warmup after the artifact landed) — show the warming chip.
 */
export function comparisonsWarming(meta: PrSummary): boolean {
  const status = meta.generation?.status;
  return meta.briefAvailable && (status === "queued" || status === "running");
}

/**
 * The viewer is pinned to `span` but the PR head moved on — offer navigation,
 * never yank the page out from under them (invisible-mode rule: behavior
 * follows visible state).
 */
export function headAdvanced(meta: PrSummary, pinnedSpan: Span): boolean {
  return meta.headSha !== null && meta.headSha !== pinnedSpan.head;
}
