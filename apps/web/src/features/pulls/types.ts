// Read-API PR shapes, mirroring the api package's `pr-view` response contract.
import type { LastReviewUnavailableReason, WaitReason } from "contract";
import type { Result as SharedResult, ValueOf } from "types/utils";
import type {
  ForkPrStack,
  LinearPrStack,
  PrStack,
  PullStack,
  PrStackMember,
} from "@web/features/brief/model";

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

export interface UnavailableLastReviewComparison {
  readonly kind: "unavailable";
  readonly reason: LastReviewUnavailableReason;
}

export type LastReviewComparison =
  | AvailableLastReviewComparison
  | UnavailableLastReviewComparison;

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
  /** The PR author's GitHub login; absent when GitHub sent no user. */
  readonly authorLogin?: string;
  /** Whether the requesting viewer authored this PR, derived server-side per request. */
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
