// The DB-brief route's wait-UX state machine, kept PURE so the whole map is
// unit-testable. Render trigger = brief artifact EXISTS for the resolved span
// and NEVER `status === "succeeded"` (the run finishes only after delta
// warmup, well after the artifact is readable). Generation status drives the
// waiting/failed/superseded display and the polling cadence only.
import {
  LastReviewUnavailableReasons,
  type GenerationPartsView,
  type WaitReason,
} from "contract";
import {
  GenerationStatuses,
  type GenerationFailureCode,
  type GenerationUnitsParams,
} from "types/generations";
import { deriveGenerationWait } from "@web/utils/generation-wait";
import { GenerationWaits } from "@web/utils/generation-wait/types";
import { UnknownValues } from "@web/utils/open-enum/types";
import { IN_FLIGHT_POLL_MS, LIVE_POLL_MS } from "../consts";
import type { DbTimelineSelection } from "./dbTimeline";
import { readSupersededStop } from "./pr-state";
import { isOwnDraft } from "./ownDraft";
import type { HeldCondition } from "../components/PrBrief/held-head/types";
import type { GenerationSummary, PrSummary } from "../types";

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
      readonly phase: string | undefined;
      readonly span: Span | undefined;
      readonly waitReason: WaitReason | undefined;
      /** A running multi-call run's progress, once its parts are planned. */
      readonly parts: GenerationPartsView | undefined;
      readonly startedAt: string | undefined;
    }
  /** Terminal failure: the catalog code, when known, plus attempts. */
  | {
      readonly kind: "failed";
      readonly errorCode: GenerationFailureCode | undefined;
      readonly errorDetail: string | undefined;
      readonly attempts: number;
    }
  /** Aborted because the head advanced; a newer brief is on the way. */
  | { readonly kind: "superseded" }
  /** The PR waits for a collaborator's Trigger approval; nothing ran. */
  | { readonly kind: "awaiting-trigger" }
  /** Trigger conditions hold the head; nothing ran. Unknown conditions are dropped and mark the list partial. */
  | {
      readonly kind: "held";
      readonly unmetConditions: readonly HeldCondition[];
      readonly unmetConditionsPartial: boolean;
    }
  /**
   * Skipped: the repo hit the instance's daily generation cap. `cappedAt` is
   * when the skip was recorded, and the reset time derives from it, so a row
   * left over from an earlier day cannot claim to be waiting on tonight's
   * midnight. `units` names what a refused large run needed.
   */
  | {
      readonly kind: "capped";
      readonly cappedAt: string;
      readonly units?: GenerationUnitsParams | undefined;
    };

/**
 * A brief is stored for the current head, on any base: what display, polling
 * and route state ask. Action offers read `briefAvailable`, the regenerate
 * route's test for a failed head. A server older than `headBriefStored`
 * meant this by `briefAvailable`.
 */
export function hasStoredHeadBrief(meta: PrSummary): boolean {
  return meta.headBriefStored ?? meta.briefAvailable;
}

const NO_UNMET_CONDITIONS: readonly HeldCondition[] = [];

function isInFlight(status: GenerationSummary["status"] | undefined): boolean {
  return (
    status === GenerationStatuses.PENDING ||
    status === GenerationStatuses.RUNNING
  );
}

function metaSpan(meta: PrSummary): Span | undefined {
  if (meta.baseSha === undefined || meta.headSha === undefined) {
    return undefined;
  }
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
  return meta.headSha === explicitSpan.head;
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
  const explicitAwaitsHead =
    explicitSpan !== undefined &&
    explicitNamesGeneratingHead(meta, explicitSpan) &&
    !hasStoredHeadBrief(meta);
  const rendersExplicitSpan = explicitSpan !== undefined && !explicitAwaitsHead;
  if (rendersExplicitSpan) {
    return { kind: "render", span: explicitSpan };
  }
  const span = metaSpan(meta);
  const rendersHeadBrief = hasStoredHeadBrief(meta) && span !== undefined;
  if (rendersHeadBrief) {
    return { kind: "render", span };
  }
  const generation = meta.generation;
  if (generation === undefined) {
    return { kind: "empty" };
  }
  switch (generation.status) {
    case GenerationStatuses.PENDING:
    case GenerationStatuses.RUNNING:
      return {
        kind: "waiting",
        status: generation.status,
        phase: generation.phase,
        span,
        waitReason: generation.waitReason,
        parts: generation.parts,
        startedAt: generation.startedAt,
      };
    case GenerationStatuses.FAILED:
      return {
        kind: "failed",
        errorCode: generation.errorCode,
        errorDetail: generation.errorDetail,
        attempts: generation.attempts,
      };
    case GenerationStatuses.SUPERSEDED:
      return { kind: "superseded" };
    case GenerationStatuses.CAPPED:
      return {
        kind: "capped",
        cappedAt: generation.updatedAt,
        units: generation.cappedUnits,
      };
    case GenerationStatuses.AWAITING_TRIGGER:
      return { kind: "awaiting-trigger" };
    case GenerationStatuses.HELD:
      return {
        kind: "held",
        unmetConditions: generation.unmetConditions ?? NO_UNMET_CONDITIONS,
        unmetConditionsPartial: generation.unmetConditionsPartial === true,
      };
    case GenerationStatuses.SUCCEEDED:
    case UnknownValues.UNKNOWN:
      // Succeeded without a readable artifact, or a status this bundle
      // predates: not a failure and nothing known to be coming, so the empty
      // state.
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
    !hasStoredHeadBrief(meta) &&
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
 * generation, a superseded row whose replacement is queued, a
 * rendered brief whose generation is still finishing (the "comparisons
 * warming" chip clears on the terminal refetch), or the viewer's OWN DRAFT:
 * the draft flag can flip externally (marked ready on GitHub) and the
 * own-draft affordances key on it, so a settled draft would otherwise only
 * propagate on a window-focus refetch. Scoped to the author: other viewers
 * carry no draft-keyed affordances, so no poll cost across every open draft.
 */
export function shouldPollMeta(meta: PrSummary): boolean {
  if (isOwnDraft(meta)) {
    return true;
  }
  const status = meta.generation?.status;
  // A stalled head has no job left to run: it polls at the settled pace.
  const inFlight =
    deriveGenerationWait(meta.generation) === GenerationWaits.IN_FLIGHT;
  if (inFlight) {
    return true;
  }
  const awaitsReplacement =
    status === GenerationStatuses.SUPERSEDED &&
    !hasStoredHeadBrief(meta) &&
    readSupersededStop(meta) === undefined;
  if (awaitsReplacement) {
    return true;
  }
  // A pending lastReview comparison is also in-flight work (its delta may
  // finish after the brief generation is terminal): keep polling so the
  // disabled Compare control flips without a manual refresh.
  const lastReviewPending =
    meta.comparisons?.lastReview?.kind === "unavailable" &&
    meta.comparisons.lastReview.reason === LastReviewUnavailableReasons.PENDING;
  return lastReviewPending;
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
  const warming =
    hasStoredHeadBrief(meta) && isInFlight(meta.generation?.status);
  return warming;
}
