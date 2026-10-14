import type { LastReviewUnavailableReason, WaitReason } from "contract";
import type { GenerationFailureCode, GenerationStatus, PrState } from "types";
import type { UnknownValue } from "@web/utils/open-enum/types";

/** The poll-relevant slice of the generation projection (already sanitized). */
export interface GenerationSummary {
  readonly status: GenerationStatus | UnknownValue;
  readonly phase?: string;
  readonly attempts: number;
  /** Absent when the row never failed, or when the code is one we don't know. */
  readonly errorCode?: GenerationFailureCode;
  readonly errorDetail?: string;
  readonly updatedAt: string;
  /** PR meta only, and only while pending; absent means the generic line. */
  readonly waitReason?: WaitReason;
}

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
  readonly reason: LastReviewUnavailableReason | UnknownValue;
}

export type LastReviewComparison =
  | AvailableLastReviewComparison
  | UnavailableLastReviewComparison;

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

export interface DraftPolicySummary {
  readonly generate: boolean;
  readonly debounceSeconds?: number;
}

export interface PrSummary {
  readonly repoId: string;
  readonly repoSlug?: string;
  readonly prNumber: number;
  readonly title?: string;
  readonly state: PrState | UnknownValue;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly briefAvailable: boolean;
  readonly draft: boolean;
  readonly authorLogin?: string;
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
  readonly generation?: GenerationSummary;
  readonly updatedAt: string;
  /** GitHub reports a head the latest brief does not cover; a server predating the field reads false. */
  readonly behind: boolean;
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
