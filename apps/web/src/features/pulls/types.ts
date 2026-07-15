// Read-API PR shapes + boundary guards (BRIEF-19 PR 3.1). Mirrors the api
// package's `pr-view` response contract. Hand-rolled guards returning
// `Result`, matching the local-brief validation convention (no zod in this
// bundle); API responses are parsed at the boundary, never cast.
import type { Result as SharedResult, ValueOf } from "types";

type Result<T> = SharedResult<T, string>;

export const PrStates = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
} as const;
export type PrState = ValueOf<typeof PrStates>;

export const GenerationStatuses = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SUPERSEDED: "superseded",
} as const;
export type GenerationStatus = ValueOf<typeof GenerationStatuses>;

/** The poll-relevant slice of the generation projection (already sanitized). */
export interface GenerationSummary {
  readonly status: GenerationStatus;
  readonly phase: string | null;
  readonly attempts: number;
  readonly error: string | null;
  readonly updatedAt: string;
}

/** Previous-brief comparison availability on PR meta (BRIEF-19 4.1). */
export interface PreviousBriefComparison {
  readonly baselineSha: string;
  readonly baselineIndex: number;
  readonly narrativeAvailable: boolean;
}

/** Why lastReview is unavailable despite a recorded checkpoint (BRIEF-21). */
export const LastReviewUnavailableReasons = {
  PENDING: "pending",
  BASELINE_UNAVAILABLE: "baseline-unavailable",
} as const;
export type LastReviewUnavailableReason = ValueOf<
  typeof LastReviewUnavailableReasons
>;

/**
 * The per-reviewer "since my last review" comparison on PR meta (BRIEF-21).
 * The wire union is shape-discriminated (`unavailable` key vs payload); the
 * parsed form adds `kind` so consumers switch without re-probing keys. The
 * field being ABSENT from `comparisons` means the reviewer never submitted —
 * no control at all, nothing to explain.
 */
export type LastReviewComparison =
  | {
      readonly kind: "available";
      /** False = marks-only tier: still an offer, the delta core was skipped. */
      readonly deltaAvailable: boolean;
      readonly baselineSha: string;
      /** Present when the checkpoint SHA was a briefed head. */
      readonly baselineIndex?: number;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: LastReviewUnavailableReason;
    };

/** Comparison availability envelope — additive (BRIEF-21 adds lastReview). */
export interface PrComparisons {
  readonly previousBrief?: PreviousBriefComparison;
  readonly lastReview?: LastReviewComparison;
}

/**
 * One browsable Brief revision on PR meta (BRIEF-24). `baseSha` is PER-ENTRY
 * and load-bearing: the base drifts across revisions (base-branch advance /
 * retarget) and the brief GET is an exact `(pr, base, head)` lookup, so the
 * navigator fetches each revision with ITS OWN base — never the top-level
 * view's. Ordered by `headIndex` ascending; `comparisons` mirrors the
 * top-level envelope (empty object when neither baseline has marks here).
 */
export interface RevisionSummary {
  readonly headSha: string;
  readonly baseSha: string;
  readonly headIndex: number;
  readonly createdAt: string;
  readonly comparisons: PrComparisons;
}

/** One PR as the list and PR-meta endpoints return it. */
export interface PrSummary {
  readonly repoId: string;
  readonly repoSlug: string | null;
  readonly prNumber: number;
  readonly title: string | null;
  readonly state: PrState;
  /** Current span's brief base; null while the span has no brief yet. */
  readonly baseSha: string | null;
  /** The current push's head; null only when nothing was ever projected. */
  readonly headSha: string | null;
  readonly briefAvailable: boolean;
  /** GitHub draft state (BRIEF-43); with `viewerIsAuthor` it derives own-draft affordances. */
  readonly draft: boolean;
  /**
   * Whether the requesting viewer authored this PR (BRIEF-43) — derived
   * server-side per request; the author login itself never crosses the wire.
   */
  readonly viewerIsAuthor: boolean;
  readonly generation: GenerationSummary | null;
  readonly updatedAt: string;
  /** Present on PR-meta responses only; absent on list rows. */
  readonly comparisons?: PrComparisons;
  /**
   * The browsable revision timeline (BRIEF-24) — present on PR-meta only when
   * `briefAvailable` (no brief, no head, no history). Ordered by `headIndex`.
   */
  readonly revisions?: readonly RevisionSummary[];
}

/**
 * The picker's view of `GET /api/pulls`. Logged-out (401) and
 * backend-unavailable (502/503 — GitHub or composition down) are both
 * EXPECTED states the picker renders inline; only contract violations throw.
 */
export type PullsSession =
  | { readonly kind: "logged-out" }
  | { readonly kind: "ready"; readonly pulls: PrSummary[] }
  | { readonly kind: "unavailable" };

// ---------------------------------------------------------------------------
// Guards.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * The wire shape of a repo id is a NUMERIC string (bigints are stringified
 * server-side). Anything else is malformed data — and since the picker
 * interpolates this into `/repos/{repoId}/...` URLs, a loose string would
 * become an unintended route instead of a rejected response.
 */
function isRepoIdString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isPrState(value: unknown): value is PrState {
  return (
    typeof value === "string" &&
    Object.values(PrStates).some((state) => state === value)
  );
}

function isGenerationStatus(value: unknown): value is GenerationStatus {
  return (
    typeof value === "string" &&
    Object.values(GenerationStatuses).some((status) => status === value)
  );
}

function parseGenerationSummary(
  value: unknown,
): Result<GenerationSummary | null> {
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value))
    return { ok: false, error: "generation must be an object or null" };
  if (!isGenerationStatus(value["status"])) {
    return { ok: false, error: "generation.status is not a known status" };
  }
  if (!isStringOrNull(value["phase"])) {
    return { ok: false, error: "generation.phase must be a string or null" };
  }
  if (typeof value["attempts"] !== "number") {
    return { ok: false, error: "generation.attempts must be a number" };
  }
  if (!isStringOrNull(value["error"])) {
    return { ok: false, error: "generation.error must be a string or null" };
  }
  if (typeof value["updatedAt"] !== "string") {
    return { ok: false, error: "generation.updatedAt must be a string" };
  }
  return {
    ok: true,
    value: {
      status: value["status"],
      phase: value["phase"],
      attempts: value["attempts"],
      error: value["error"],
      updatedAt: value["updatedAt"],
    },
  };
}

function parsePreviousBrief(
  value: unknown,
): Result<PreviousBriefComparison | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) {
    return { ok: false, error: "comparisons.previousBrief must be an object" };
  }
  if (typeof value["baselineSha"] !== "string") {
    return { ok: false, error: "previousBrief.baselineSha must be a string" };
  }
  if (typeof value["baselineIndex"] !== "number") {
    return { ok: false, error: "previousBrief.baselineIndex must be a number" };
  }
  if (typeof value["narrativeAvailable"] !== "boolean") {
    return {
      ok: false,
      error: "previousBrief.narrativeAvailable must be a boolean",
    };
  }
  return {
    ok: true,
    value: {
      baselineSha: value["baselineSha"],
      baselineIndex: value["baselineIndex"],
      narrativeAvailable: value["narrativeAvailable"],
    },
  };
}

function isLastReviewUnavailableReason(
  value: unknown,
): value is LastReviewUnavailableReason {
  return (
    typeof value === "string" &&
    Object.values(LastReviewUnavailableReasons).some(
      (reason) => reason === value,
    )
  );
}

function parseLastReview(
  value: unknown,
): Result<LastReviewComparison | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) {
    return { ok: false, error: "comparisons.lastReview must be an object" };
  }
  // The wire union discriminates on the `unavailable` key (BRIEF-21).
  if ("unavailable" in value) {
    if (!isLastReviewUnavailableReason(value["unavailable"])) {
      return {
        ok: false,
        error: "lastReview.unavailable is not a known reason",
      };
    }
    return {
      ok: true,
      value: { kind: "unavailable", reason: value["unavailable"] },
    };
  }
  if (typeof value["deltaAvailable"] !== "boolean") {
    return { ok: false, error: "lastReview.deltaAvailable must be a boolean" };
  }
  if (typeof value["baselineSha"] !== "string") {
    return { ok: false, error: "lastReview.baselineSha must be a string" };
  }
  const baselineIndex = value["baselineIndex"];
  if (baselineIndex !== undefined && typeof baselineIndex !== "number") {
    return {
      ok: false,
      error: "lastReview.baselineIndex must be a number when present",
    };
  }
  return {
    ok: true,
    value: {
      kind: "available",
      deltaAvailable: value["deltaAvailable"],
      baselineSha: value["baselineSha"],
      ...(baselineIndex === undefined ? {} : { baselineIndex }),
    },
  };
}

function parseComparisons(value: unknown): Result<PrComparisons | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value))
    return { ok: false, error: "comparisons must be an object" };
  const previousBrief = parsePreviousBrief(value["previousBrief"]);
  if (!previousBrief.ok) return previousBrief;
  const lastReview = parseLastReview(value["lastReview"]);
  if (!lastReview.ok) return lastReview;
  return {
    ok: true,
    value: {
      ...(previousBrief.value === undefined
        ? {}
        : { previousBrief: previousBrief.value }),
      ...(lastReview.value === undefined
        ? {}
        : { lastReview: lastReview.value }),
    },
  };
}

function parseRevision(value: unknown): Result<RevisionSummary> {
  if (!isRecord(value))
    return { ok: false, error: "revision must be an object" };
  if (typeof value["headSha"] !== "string") {
    return { ok: false, error: "revision.headSha must be a string" };
  }
  if (typeof value["baseSha"] !== "string") {
    return { ok: false, error: "revision.baseSha must be a string" };
  }
  if (typeof value["headIndex"] !== "number") {
    return { ok: false, error: "revision.headIndex must be a number" };
  }
  if (typeof value["createdAt"] !== "string") {
    return { ok: false, error: "revision.createdAt must be a string" };
  }
  // A revision's `comparisons` is the SAME envelope as the top-level one
  // (empty object when neither baseline has marks) — reuse its guard so the
  // two can never drift.
  const comparisons = parseComparisons(value["comparisons"]);
  if (!comparisons.ok) return comparisons;
  return {
    ok: true,
    value: {
      headSha: value["headSha"],
      baseSha: value["baseSha"],
      headIndex: value["headIndex"],
      createdAt: value["createdAt"],
      comparisons: comparisons.value ?? {},
    },
  };
}

function parseRevisions(
  value: unknown,
): Result<readonly RevisionSummary[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) {
    return { ok: false, error: "revisions must be an array" };
  }
  const revisions: RevisionSummary[] = [];
  for (const item of value) {
    const parsed = parseRevision(item);
    if (!parsed.ok) return parsed;
    revisions.push(parsed.value);
  }
  return { ok: true, value: revisions };
}

export function parsePrSummary(value: unknown): Result<PrSummary> {
  if (!isRecord(value))
    return { ok: false, error: "PR summary must be an object" };
  if (!isRepoIdString(value["repoId"])) {
    return { ok: false, error: "repoId must be a numeric string" };
  }
  if (!isStringOrNull(value["repoSlug"])) {
    return { ok: false, error: "repoSlug must be a string or null" };
  }
  if (typeof value["prNumber"] !== "number") {
    return { ok: false, error: "prNumber must be a number" };
  }
  if (!isStringOrNull(value["title"])) {
    return { ok: false, error: "title must be a string or null" };
  }
  if (!isPrState(value["state"])) {
    return { ok: false, error: "state is not a known PR state" };
  }
  if (!isStringOrNull(value["baseSha"]) || !isStringOrNull(value["headSha"])) {
    return { ok: false, error: "baseSha/headSha must be strings or null" };
  }
  if (typeof value["briefAvailable"] !== "boolean") {
    return { ok: false, error: "briefAvailable must be a boolean" };
  }
  // Both BRIEF-43 booleans are REQUIRED on every row (list and meta): they
  // gate author-only affordances, so a missing field is a contract violation,
  // never a silent false.
  if (typeof value["draft"] !== "boolean") {
    return { ok: false, error: "draft must be a boolean" };
  }
  if (typeof value["viewerIsAuthor"] !== "boolean") {
    return { ok: false, error: "viewerIsAuthor must be a boolean" };
  }
  const generation = parseGenerationSummary(value["generation"]);
  if (!generation.ok) return generation;
  if (typeof value["updatedAt"] !== "string") {
    return { ok: false, error: "updatedAt must be a string" };
  }
  const comparisons = parseComparisons(value["comparisons"]);
  if (!comparisons.ok) return comparisons;
  const revisions = parseRevisions(value["revisions"]);
  if (!revisions.ok) return revisions;
  return {
    ok: true,
    value: {
      repoId: value["repoId"],
      repoSlug: value["repoSlug"],
      prNumber: value["prNumber"],
      title: value["title"],
      state: value["state"],
      baseSha: value["baseSha"],
      headSha: value["headSha"],
      briefAvailable: value["briefAvailable"],
      draft: value["draft"],
      viewerIsAuthor: value["viewerIsAuthor"],
      generation: generation.value,
      updatedAt: value["updatedAt"],
      ...(comparisons.value === undefined
        ? {}
        : { comparisons: comparisons.value }),
      ...(revisions.value === undefined ? {} : { revisions: revisions.value }),
    },
  };
}

export function parsePullsList(value: unknown): Result<PrSummary[]> {
  if (!isRecord(value) || !Array.isArray(value["pulls"])) {
    return { ok: false, error: "list response must be { pulls: [...] }" };
  }
  const pulls: PrSummary[] = [];
  for (const item of value["pulls"]) {
    const parsed = parsePrSummary(item);
    if (!parsed.ok) return parsed;
    pulls.push(parsed.value);
  }
  return { ok: true, value: pulls };
}
