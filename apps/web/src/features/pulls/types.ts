// Read-API PR shapes + boundary guards. Mirrors the api package's `pr-view`
// response contract. Hand-rolled guards returning `Result` (no zod in this
// bundle); API responses are parsed at the boundary, never cast.
import {
  LastReviewUnavailableReasons,
  WaitReasons,
  type LastReviewUnavailableReason,
  type WaitReason,
} from "contract";
import type { Mutable, Result as SharedResult, ValueOf } from "types/utils";
import type {
  ForkPrStack,
  LinearPrStack,
  PrStack,
  PullStack,
  PrStackMember,
} from "@web/features/brief/types";

type Result<T> = SharedResult<T, string>;

export const PrStates = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
} as const;
export type PrState = ValueOf<typeof PrStates>;

/** Where a pull request row came from: an App installation, or a pasted URL. */
export const PullRequestSources = {
  INSTALLATION: "installation",
  URL: "url",
} as const;
/** @public */
export type PullRequestSource = ValueOf<typeof PullRequestSources>;

/**
 * `capped` = the repo hit the instance's daily generation cap and this run was
 * SKIPPED. Terminal and deliberately NOT `failed`: nothing went wrong, and
 * the view says when generation resumes.
 */
export const GenerationStatuses = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SUPERSEDED: "superseded",
  CAPPED: "capped",
} as const;
export type GenerationStatus = ValueOf<typeof GenerationStatuses>;

/**
 * Hand-rolled mirror of persistence's `GenerationFailureCode`, modeled data
 * inside a 200, so it never rides the wire-error vocabulary. An unknown code
 * degrades to the generic failed line rather than failing the parse: the
 * server may ship a code this bundle predates.
 */
export const GenerationFailureCodes = {
  PROVIDER_AUTH: "provider-auth",
  PROVIDER_RATE_LIMIT: "provider-rate-limit",
  PROVIDER_TIMEOUT: "provider-timeout",
  PROVIDER_UNAVAILABLE: "provider-unavailable",
  PROVIDER_REFUSAL: "provider-refusal",
  OUTPUT_INVALID: "output-invalid",
  GENERATION_CONFIG: "generation-config",
  GITHUB_ACCESS: "github-access",
  DIFF_TOO_LARGE: "diff-too-large",
  GITHUB_UNAVAILABLE: "github-unavailable",
  ATTEMPTS_EXHAUSTED: "attempts-exhausted",
  UNKNOWN: "unknown",
} as const;
export type GenerationFailureCode = ValueOf<typeof GenerationFailureCodes>;

const FAILURE_CODE_VALUES: readonly string[] = Object.values(
  GenerationFailureCodes,
);

export function isGenerationFailureCode(
  value: unknown,
): value is GenerationFailureCode {
  return typeof value === "string" && FAILURE_CODE_VALUES.includes(value);
}

/** The poll-relevant slice of the generation projection (already sanitized). */
export interface GenerationSummary {
  readonly status: GenerationStatus;
  readonly phase: string | null;
  readonly attempts: number;
  /** Null when the row never failed, or when the code is one we don't know. */
  readonly errorCode: GenerationFailureCode | null;
  readonly errorDetail: string | null;
  readonly updatedAt: string;
  /** PR meta only, and only while pending; absent means the generic line. */
  readonly waitReason?: WaitReason;
}

/** Previous-brief comparison availability on PR meta. */
export interface PreviousBriefComparison {
  readonly baselineSha: string;
  readonly baselineIndex: number;
  readonly narrativeAvailable: boolean;
}

/**
 * The wire discriminates by the unavailable key; parsing adds kind for consumers.
 * An absent comparison means no prior submission and therefore no control to explain.
 */
export interface AvailableLastReviewComparison {
  readonly kind: "available";
  /** False = marks-only tier: still an offer, the delta core was skipped. */
  readonly deltaAvailable: boolean;
  readonly baselineSha: string;
  /** Present when the checkpoint SHA was a briefed head. */
  readonly baselineIndex?: number;
}

export type LastReviewComparison =
  | AvailableLastReviewComparison
  | {
      readonly kind: "unavailable";
      readonly reason: LastReviewUnavailableReason;
    };

/** Comparison availability envelope, additive. */
export interface PrComparisons {
  readonly previousBrief?: PreviousBriefComparison;
  readonly lastReview?: LastReviewComparison;
}

/**
 * Fetch each revision with its own baseSha: branch advances and retargets change it.
 * The brief lookup requires the exact pr/base/head tuple, never the top-level view's base.
 * Entries use ascending headIndex; comparisons mirrors the top-level envelope.
 */
export interface RevisionSummary {
  readonly headSha: string;
  readonly baseSha: string;
  readonly headIndex: number;
  readonly createdAt: string;
  /**
   * When this revision's brief generation started, the conversation cutoff:
   * comments newer than this postdate the brief. Absent on wire bodies from
   * servers predating the field.
   */
  readonly generatedAt?: string;
  readonly comparisons: PrComparisons;
}

/** The instance draft-PR policy slice the meta response echoes. */
export interface DraftPolicySummary {
  /** Whether briefs generate for draft PRs at all on this instance. */
  readonly generate: boolean;
  /** Draft regeneration damping window (seconds); null = normal window. */
  readonly debounceSeconds: number | null;
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
  /** GitHub draft state; with `viewerIsAuthor` it derives own-draft affordances. */
  readonly draft: boolean;
  /**
   * Whether the requesting viewer authored this PR, derived server-side per
   * request; the author login itself never crosses the wire.
   */
  readonly viewerIsAuthor: boolean;
  /**
   * Read this affordance from PR meta only: list rows omit the push-permission check.
   * GitHub still enforces push permission or authorship at mutation time.
   */
  readonly viewerCanResolve: boolean;
  /**
   * The PR sits in an installation's world, so the App can push an
   * attachment for it. PR-meta only; a server predating the field reads
   * false and the composer's attach control stays off.
   */
  readonly appInstalled: boolean;
  readonly generation: GenerationSummary | null;
  readonly updatedAt: string;
  /** GitHub reports a head the latest brief does not cover; a server predating the field reads false. */
  readonly behind: boolean;
  /** Present on PR-meta responses only; absent on list rows. */
  readonly comparisons?: PrComparisons;
  /**
   * Instance draft-PR policy, PR-meta only. Drives the own-draft copy states;
   * the refresh copy must state the CONFIGURED window, never a hardcoded
   * duration.
   */
  readonly draftPolicy?: DraftPolicySummary;
  /**
   * The browsable revision timeline, present on PR-meta only when
   * `briefAvailable` (no brief, no head, no history). Ordered by `headIndex`.
   */
  readonly revisions?: readonly RevisionSummary[];
}

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
 * server-side). Anything else is malformed data, and since the picker
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

function isWaitReason(value: unknown): value is WaitReason {
  return (
    typeof value === "string" &&
    Object.values(WaitReasons).some((reason) => reason === value)
  );
}

function parseGenerationSummary(
  value: unknown,
): Result<GenerationSummary | null> {
  if (value === null) {
    return { ok: true, value: null };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "generation must be an object or null" };
  }
  if (!isGenerationStatus(value["status"])) {
    return { ok: false, error: "generation.status is not a known status" };
  }
  if (!isStringOrNull(value["phase"])) {
    return { ok: false, error: "generation.phase must be a string or null" };
  }
  if (typeof value["attempts"] !== "number") {
    return { ok: false, error: "generation.attempts must be a number" };
  }
  const rawParams = value["errorParams"];
  if (rawParams !== null && rawParams !== undefined && !isRecord(rawParams)) {
    return {
      ok: false,
      error: "generation.errorParams must be an object or null",
    };
  }
  if (typeof value["updatedAt"] !== "string") {
    return { ok: false, error: "generation.updatedAt must be a string" };
  }
  const summary: Mutable<GenerationSummary> = {
    status: value["status"],
    phase: value["phase"],
    attempts: value["attempts"],
    // Tolerant on purpose: a code this bundle predates parses as null and
    // renders the generic failed line, rather than failing the whole view.
    errorCode: isGenerationFailureCode(value["errorCode"])
      ? value["errorCode"]
      : null,
    errorDetail:
      isRecord(rawParams) && typeof rawParams["detail"] === "string"
        ? rawParams["detail"]
        : null,
    updatedAt: value["updatedAt"],
  };

  // Tolerant like errorCode: an unknown reason shows the generic pending line.
  if (isWaitReason(value["waitReason"])) {
    summary.waitReason = value["waitReason"];
  }
  return { ok: true, value: summary };
}

function parsePreviousBrief(
  value: unknown,
): Result<PreviousBriefComparison | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
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
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "comparisons.lastReview must be an object" };
  }
  // The wire union discriminates on the `unavailable` key.
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
  const available: Mutable<AvailableLastReviewComparison> = {
    kind: "available",
    deltaAvailable: value["deltaAvailable"],
    baselineSha: value["baselineSha"],
  };

  if (baselineIndex !== undefined) {
    available.baselineIndex = baselineIndex;
  }

  return { ok: true, value: available };
}

/** Absent (list rows) parses to undefined; present must be well-formed. */
function parseDraftPolicy(
  value: unknown,
): Result<DraftPolicySummary | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "draftPolicy must be an object" };
  }
  if (typeof value["generate"] !== "boolean") {
    return { ok: false, error: "draftPolicy.generate must be a boolean" };
  }
  const debounceSeconds = value["debounceSeconds"];
  if (debounceSeconds !== null && typeof debounceSeconds !== "number") {
    return {
      ok: false,
      error: "draftPolicy.debounceSeconds must be a number or null",
    };
  }
  return { ok: true, value: { generate: value["generate"], debounceSeconds } };
}

function parseComparisons(value: unknown): Result<PrComparisons | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "comparisons must be an object" };
  }
  const previousBrief = parsePreviousBrief(value["previousBrief"]);
  if (!previousBrief.ok) {
    return previousBrief;
  }
  const lastReview = parseLastReview(value["lastReview"]);
  if (!lastReview.ok) {
    return lastReview;
  }
  const comparisons: Mutable<PrComparisons> = {};

  if (previousBrief.value !== undefined) {
    comparisons.previousBrief = previousBrief.value;
  }
  if (lastReview.value !== undefined) {
    comparisons.lastReview = lastReview.value;
  }

  return { ok: true, value: comparisons };
}

function parseRevision(value: unknown): Result<RevisionSummary> {
  if (!isRecord(value)) {
    return { ok: false, error: "revision must be an object" };
  }
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
  const generatedAt = value["generatedAt"];
  if (generatedAt !== undefined && typeof generatedAt !== "string") {
    return { ok: false, error: "revision.generatedAt must be a string" };
  }
  // A revision's `comparisons` is the SAME envelope as the top-level one
  // (empty object when neither baseline has marks), reuse its guard so the
  // two can never drift.
  const comparisons = parseComparisons(value["comparisons"]);
  if (!comparisons.ok) {
    return comparisons;
  }
  const revision: Mutable<RevisionSummary> = {
    headSha: value["headSha"],
    baseSha: value["baseSha"],
    headIndex: value["headIndex"],
    createdAt: value["createdAt"],
    comparisons: comparisons.value ?? {},
  };

  if (generatedAt !== undefined) {
    revision.generatedAt = generatedAt;
  }

  return { ok: true, value: revision };
}

function parseRevisions(
  value: unknown,
): Result<readonly RevisionSummary[] | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: "revisions must be an array" };
  }
  const revisions: RevisionSummary[] = [];
  for (const item of value) {
    const parsed = parseRevision(item);
    if (!parsed.ok) {
      return parsed;
    }
    revisions.push(parsed.value);
  }
  return { ok: true, value: revisions };
}

export function parsePrSummary(value: unknown): Result<PrSummary> {
  if (!isRecord(value)) {
    return { ok: false, error: "PR summary must be an object" };
  }
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
  // Both booleans are REQUIRED on every row (list and meta): they gate
  // author-only affordances, so a missing field is a contract violation,
  // never a silent false.
  if (typeof value["draft"] !== "boolean") {
    return { ok: false, error: "draft must be a boolean" };
  }
  if (typeof value["viewerIsAuthor"] !== "boolean") {
    return { ok: false, error: "viewerIsAuthor must be a boolean" };
  }
  // Deliberately NOT required: a server predating the field parses fine and
  // yields `false`, fail closed, the affordance simply never shows.
  // Present-but-not-a-boolean is still malformed: coercing a truthy string
  // would hand out a capability the server never granted.
  const viewerCanResolve = value["viewerCanResolve"];
  if (viewerCanResolve !== undefined && typeof viewerCanResolve !== "boolean") {
    return {
      ok: false,
      error: "viewerCanResolve must be a boolean when present",
    };
  }
  const appInstalled = value["appInstalled"];
  if (appInstalled !== undefined && typeof appInstalled !== "boolean") {
    return { ok: false, error: "appInstalled must be a boolean when present" };
  }
  const generation = parseGenerationSummary(value["generation"]);
  if (!generation.ok) {
    return generation;
  }
  if (typeof value["updatedAt"] !== "string") {
    return { ok: false, error: "updatedAt must be a string" };
  }
  const behind = value["behind"];
  if (behind !== undefined && typeof behind !== "boolean") {
    return { ok: false, error: "behind must be a boolean when present" };
  }
  const comparisons = parseComparisons(value["comparisons"]);
  if (!comparisons.ok) {
    return comparisons;
  }
  const revisions = parseRevisions(value["revisions"]);
  if (!revisions.ok) {
    return revisions;
  }
  const draftPolicy = parseDraftPolicy(value["draftPolicy"]);
  if (!draftPolicy.ok) {
    return draftPolicy;
  }
  const summary: Mutable<PrSummary> = {
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
    viewerCanResolve: viewerCanResolve ?? false,
    appInstalled: appInstalled ?? false,
    generation: generation.value,
    updatedAt: value["updatedAt"],
    behind: behind ?? false,
  };

  if (comparisons.value !== undefined) {
    summary.comparisons = comparisons.value;
  }
  if (revisions.value !== undefined) {
    summary.revisions = revisions.value;
  }
  if (draftPolicy.value !== undefined) {
    summary.draftPolicy = draftPolicy.value;
  }

  return { ok: true, value: summary };
}

function parseStackMember(value: unknown): Result<PrStackMember> {
  if (!isRecord(value)) {
    return { ok: false, error: "stack member must be an object" };
  }
  if (typeof value["number"] !== "number") {
    return { ok: false, error: "stack member.number must be a number" };
  }
  if (typeof value["title"] !== "string") {
    return { ok: false, error: "stack member.title must be a string" };
  }
  return {
    ok: true,
    value: { number: value["number"], title: value["title"] },
  };
}

function parseStackMembers(value: unknown): Result<PrStackMember[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: "stack members must be an array" };
  }
  const members: PrStackMember[] = [];
  for (const item of value) {
    const parsed = parseStackMember(item);
    if (!parsed.ok) {
      return parsed;
    }
    members.push(parsed.value);
  }
  return { ok: true, value: members };
}

function parseLinearStack(
  value: Record<string, unknown>,
): Result<LinearPrStack> {
  const members = parseStackMembers(value["members"]);
  if (!members.ok) {
    return members;
  }
  if (typeof value["index"] !== "number") {
    return { ok: false, error: "stack.index must be a number" };
  }
  return { ok: true, value: { members: members.value, index: value["index"] } };
}

function parseForkStack(value: Record<string, unknown>): Result<ForkPrStack> {
  const children = parseStackMembers(value["children"]);
  if (!children.ok) {
    return children;
  }
  const fork: ForkPrStack = { children: children.value };

  if (value["parent"] !== undefined) {
    const parent = parseStackMember(value["parent"]);
    if (!parent.ok) {
      return parent;
    }
    fork.parent = parent.value;
  }

  return { ok: true, value: fork };
}

export function parsePullStack(value: unknown): Result<PullStack> {
  if (!isRecord(value)) {
    return { ok: false, error: "stack response must be an object" };
  }
  const asOf = value["asOf"];
  if (asOf !== undefined && !isDateString(asOf)) {
    return { ok: false, error: "asOf must be a date string" };
  }

  const stack = parseStackField(value["stack"]);
  if (!stack.ok) {
    return stack;
  }
  const view: PullStack = { stack: stack.value };
  if (asOf !== undefined) {
    view.asOf = asOf;
  }
  return { ok: true, value: view };
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseStackField(stack: unknown): Result<PrStack | null> {
  if (stack === null) {
    return { ok: true, value: null };
  }
  if (!isRecord(stack)) {
    return { ok: false, error: "stack must be an object or null" };
  }
  // The wire union discriminates on `members`: a chain carries them, a fork
  // carries `children`.
  return "members" in stack ? parseLinearStack(stack) : parseForkStack(stack);
}
