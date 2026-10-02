// The DB-brief route's wait-UX state machine, kept PURE so the whole map is
// unit-testable. Render trigger = brief artifact EXISTS for the resolved span
// and NEVER `status === "succeeded"` (markSucceeded fires only after delta
// warmup, well after the artifact is readable). Generation status drives the
// waiting/failed/superseded display and the polling cadence only.
import type { WaitReason } from "contract";
import { IN_FLIGHT_POLL_MS, LIVE_POLL_MS } from "../consts";
import type { DbTimelineSelection } from "./dbTimeline";
import { isOwnDraft } from "./ownDraft";
import type { GenerationFailureCode, PrSummary } from "../types";

export interface Span {
  readonly base: string;
  readonly head: string;
}

/** URL-carried explicit span (deep link / pinned view), if any. */
export type ExplicitSpan = Span | undefined;

export type BriefRouteState =
  /** A brief for `span` should be fetched and rendered. */
  | { readonly kind: "render"; readonly span: Span }
  /** Nothing was ever projected; show the activation hint. */
  | { readonly kind: "empty" }
  /** Generation in flight; diff-first wait when the span is known. */
  | {
      readonly kind: "waiting";
      readonly status: "pending" | "running";
      readonly phase: string | null;
      readonly span: Span | undefined;
      readonly waitReason: WaitReason | undefined;
    }
  /** Terminal failure: the catalog code, when known, plus attempts. */
  | {
      readonly kind: "failed";
      readonly errorCode: GenerationFailureCode | null;
      readonly errorDetail: string | null;
      readonly attempts: number;
    }
  /** Aborted because the head advanced; a newer brief is on the way. */
  | { readonly kind: "superseded" }
  /**
   * Skipped: the repo hit the instance's daily generation cap. `cappedAt` is
   * when the skip was recorded, and the reset time derives from it, so a row
   * left over from an earlier day cannot claim to be waiting on tonight's
   * midnight.
   */
  | { readonly kind: "capped"; readonly cappedAt: string };

function metaSpan(meta: PrSummary): Span | undefined {
  if (meta.baseSha === null || meta.headSha === null) return undefined;
  return { base: meta.baseSha, head: meta.headSha };
}

/**
 * The explicit span names the PR's CURRENT head. Deliberately HEAD-only: the
 * head is the revision-selection key and both sides of the compare come from
 * the same source (latestGeneration.headSha). The BASE must not veto: the
 * Entry-comment link's base comes from the generation task's fresh PR fetch,
 * while `meta.baseSha` falls back to the ingest-time row when no brief exists
 * yet, so a base drift between ingest and generation start would make a
 * both-halves compare miss and 404 the generating link again.
 */
function explicitNamesGeneratingHead(
  meta: PrSummary,
  explicitSpan: Span,
): boolean {
  return meta.headSha !== null && meta.headSha === explicitSpan.head;
}

/**
 * Derive what the route shows. An explicit span renders its brief (a deep link
 * to an older span shows that brief), EXCEPT while the PR's first Brief is
 * still generating: the Entry-comment "Brief is generating…" link names the
 * CURRENT head whose artifact does not exist yet, so a `render` there would
 * 404 the whole page. That one case degrades to the meta-derived wait state
 * (identical to a span-unknown load of a generating PR: diff-first wait with
 * the generation status). Otherwise the CURRENT span renders exactly when its
 * artifact exists; the generation summary picks the wait flavor.
 */
export function deriveBriefRouteState(
  meta: PrSummary,
  explicitSpan: ExplicitSpan,
): BriefRouteState {
  if (
    explicitSpan !== undefined &&
    !(explicitNamesGeneratingHead(meta, explicitSpan) && !meta.briefAvailable)
  ) {
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
    case "pending":
    case "running":
      return {
        kind: "waiting",
        status: generation.status,
        phase: generation.phase,
        span,
        waitReason: generation.waitReason,
      };
    case "failed":
      return {
        kind: "failed",
        errorCode: generation.errorCode,
        errorDetail: generation.errorDetail,
        attempts: generation.attempts,
      };
    case "superseded":
      return { kind: "superseded" };
    case "capped":
      return { kind: "capped", cappedAt: generation.updatedAt };
    case "succeeded":
      // Succeeded but the artifact for its head is not readable, a rare
      // inconsistency (e.g. artifact purged). Not a failure and nothing is
      // coming; fall back to the empty/activation state.
      return { kind: "empty" };
  }
}

/** What the address asks for: a legacy span, or a revision index. */
export interface BriefRouteRequest {
  readonly explicitSpan: ExplicitSpan;
  readonly rev?: number | undefined;
}

function requestNamesUnstoredRevision(
  meta: PrSummary,
  timeline: DbTimelineSelection,
  request: BriefRouteRequest,
): boolean {
  const { explicitSpan } = request;
  if (explicitSpan !== undefined) {
    const storedExactly =
      timeline.selected.headSha === explicitSpan.head &&
      timeline.selected.baseSha === explicitSpan.base;
    if (storedExactly) {
      return false;
    }
    return explicitNamesGeneratingHead(meta, explicitSpan);
  }

  const lastStoredIndex = timeline.points.at(-1)?.headIndex ?? 0;
  const revPastStored =
    request.rev !== undefined && request.rev > lastStoredIndex;
  return revPastStored;
}

/**
 * A resolved revision renders, so a stored brief stays up while a newer head
 * generates. A link naming that generating head, by span or by the next
 * `rev` the entry comment links, waits on it instead of degrading to the
 * latest stored brief.
 */
export function selectBriefRouteState(
  meta: PrSummary,
  timeline: DbTimelineSelection | undefined,
  request: BriefRouteRequest,
): BriefRouteState {
  if (timeline === undefined) {
    return deriveBriefRouteState(meta, request.explicitSpan);
  }
  const awaitsLinkedRevision =
    !meta.briefAvailable &&
    requestNamesUnstoredRevision(meta, timeline, request);
  if (awaitsLinkedRevision) {
    return deriveBriefRouteState(meta, request.explicitSpan);
  }
  return {
    kind: "render",
    span: { base: timeline.selected.baseSha, head: timeline.selected.headSha },
  };
}

/**
 * Poll the PR-meta while something is (or may be) in flight: a non-terminal
 * generation, a superseded row (its replacement is pending momentarily), a
 * rendered brief whose generation is still finishing (the "comparisons
 * warming" chip clears on the terminal refetch), or the viewer's OWN DRAFT:
 * the draft flag can flip externally (marked ready on GitHub) and the
 * own-draft affordances key on it, so a settled draft would otherwise only
 * propagate on a window-focus refetch. Scoped to the author: other viewers
 * carry no draft-keyed affordances, so no poll cost across every open draft.
 */
export function shouldPollMeta(meta: PrSummary): boolean {
  if (isOwnDraft(meta)) return true;
  const status = meta.generation?.status;
  if (status === "pending" || status === "running") return true;
  if (status === "superseded" && !meta.briefAvailable) return true;
  // A pending lastReview comparison is also in-flight work (its delta may
  // finish after the brief generation is terminal): keep polling so the
  // disabled Compare control flips without a manual refresh.
  return (
    meta.comparisons?.lastReview?.kind === "unavailable" &&
    meta.comparisons.lastReview.reason === "pending"
  );
}

/** In-flight work re-reads fast; a settled page still picks up the row's state, draft and new commits. */
export function resolveMetaPollMs(meta: PrSummary): number {
  const pollMs = shouldPollMeta(meta) ? IN_FLIGHT_POLL_MS : LIVE_POLL_MS;
  return pollMs;
}

/**
 * The rendered brief is current but its pipeline is still running (delta/
 * comparison warmup after the artifact landed); show the warming chip.
 */
export function comparisonsWarming(meta: PrSummary): boolean {
  const status = meta.generation?.status;
  return meta.briefAvailable && (status === "pending" || status === "running");
}
