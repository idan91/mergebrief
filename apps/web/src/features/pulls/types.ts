import type { TranslationKey } from "i18n";
import type {
  GenerationPartsView,
  LastReviewUnavailableReason,
  WaitReason,
} from "contract";
import type {
  GenerationFailureCode,
  GenerationStatus,
  GenerationUnitsParams,
  PrState,
  ValueOf,
} from "types";
import type { ChunkLayoutBody } from "brief-core/chunk-layout";
import type { UnknownValue } from "@web/utils/open-enum/types";
import type { HeldCondition } from "@web/utils/unmet-conditions/types";

import { WriteFailureKinds } from "../../data/request/types";

/**
 * A brief's stored chunk layout read. `body` is absent for a brief written
 * without one; the wrapper keeps the query's data defined either way.
 */
export interface StoredBriefLayout {
  body?: ChunkLayoutBody;
}

/** `read-brief-layout`'s reply; `layout` is absent for a brief stored without one. */
export interface BriefLayoutReply {
  layout?: ChunkLayoutBody;
}

/** The poll-relevant slice of the generation projection (already sanitized). */
export interface GenerationSummary {
  readonly status: GenerationStatus | UnknownValue;
  readonly phase?: string;
  readonly attempts: number;
  /** Absent when the row never failed, or when the code is one we don't know. */
  readonly errorCode?: GenerationFailureCode;
  readonly errorDetail?: string;
  /** A large run the cap refused: the runs it needed and what the day had left. */
  readonly cappedUnits?: GenerationUnitsParams;
  readonly updatedAt: string;
  /** PR meta only, and only while pending; absent means the generic line. */
  readonly waitReason?: WaitReason;
  /** PR meta only, while a run holds the row: when its attempt started. */
  readonly startedAt?: string;
  /** PR meta only, once a multi-call run planned its detail calls. */
  readonly parts?: GenerationPartsView;
  /** PR meta only, while held: the conditions this bundle reads, unknown ones dropped. */
  readonly unmetConditions?: readonly HeldCondition[];
  /** The held list left out an item, or an `any` group member, this bundle predates. */
  readonly unmetConditionsPartial?: true;
}

/** The wire discriminates by the unavailable key; parsing adds kind for consumers. */
export interface AvailablePreviousBriefComparison {
  readonly kind: "available";
  readonly baselineSha: string;
  readonly baselineIndex: number;
  readonly narrativeAvailable: boolean;
  /** The PR's own change did not move since the previous brief. */
  readonly unchanged?: true;
}

/** A previous brief exists, but its span has no marks to compare with. */
export interface UnavailablePreviousBriefComparison {
  readonly kind: "unavailable";
  readonly baselineSha: string;
  readonly baselineIndex: number;
  readonly reason: LastReviewUnavailableReason | UnknownValue;
}

export type PreviousBriefComparison =
  | AvailablePreviousBriefComparison
  | UnavailablePreviousBriefComparison;

/**
 * The wire discriminates by the unavailable key; parsing adds kind for consumers.
 * An absent comparison means no prior submission and therefore no control to explain.
 */
export interface AvailableLastReviewComparison {
  readonly kind: "available";
  /** False = marks-only tier: still an offer, the delta core was skipped. */
  readonly deltaAvailable: boolean;
  /** The span was too large to summarize: its skip record stands in for the delta. */
  readonly deltaSkipped?: true;
  /** No delta is owed: the PR's own change did not move since the checkpoint. */
  readonly deltaUnchanged?: true;
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
  /** A brief is stored for the PR's current base and head, as the regenerate route tests it. */
  readonly briefAvailable: boolean;
  /**
   * The latest brief is for `headSha`, on whatever base it was built. Absent
   * from a server that predates it; `hasStoredHeadBrief` reads that case.
   */
  readonly headBriefStored?: boolean;
  readonly draft: boolean;
  readonly authorLogin?: string;
  readonly viewerIsAuthor: boolean;
  /**
   * Read this affordance from PR meta only: a list row's push bit is the
   * listing's, without this fresh push-permission check. GitHub still
   * enforces push permission or authorship at mutation time.
   */
  readonly viewerCanResolve: boolean;
  /**
   * Push alone, PR-meta only: gates Regenerate, which GitHub never checks.
   * A server predating the field reads false.
   */
  readonly viewerCanPush: boolean;
  /**
   * The PR sits in an installation's world, so the App can push an
   * attachment for it. PR-meta only; a server predating the field reads
   * false and the composer's attach control stays off.
   */
  readonly appInstalled: boolean;
  /** Every push of this PR generates, trigger conditions or not; a server predating the field reads false. */
  readonly generateEveryPush: boolean;
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
   * The browsable revision timeline, present on PR-meta once any brief is
   * stored (no brief, no history). Ordered by `headIndex`.
   */
  readonly revisions?: readonly RevisionSummary[];
}

/** Why a superseded installation run has no newer push coming after it. */
export const SupersededStops = {
  /** The PR closed or merged: the worker stands its run down. */
  CLOSED: "closed",
} as const;
export type SupersededStop = ValueOf<typeof SupersededStops>;

/** What a Regenerate click came back with. */
export const RegenerateResultKinds = {
  QUEUED: "queued",
  /** A run already holds the head; the meta read shows it. */
  RUNNING: "running",
  /** The head moved past failed, or failed in a way a rerun cannot help. */
  NOT_REGENERABLE: "not-regenerable",
  /** No push access, no App installation, a token below the write, or the row is gone. */
  NOT_ALLOWED: "not-allowed",
  UNAUTHORIZED: WriteFailureKinds.UNAUTHORIZED,
  UPSTREAM: "upstream",
  INDETERMINATE: WriteFailureKinds.INDETERMINATE,
} as const;
export type RegenerateResultKind = ValueOf<typeof RegenerateResultKinds>;

export interface RegenerateResult {
  readonly kind: RegenerateResultKind;
}

/** What turning generate on every push on or off answered. */
export const EveryPushResultKinds = {
  SAVED: "saved",
  /** No push access, no App installation, a session-only refusal, or the row is gone. */
  NOT_ALLOWED: "not-allowed",
  UNAUTHORIZED: WriteFailureKinds.UNAUTHORIZED,
  UPSTREAM: "upstream",
  INDETERMINATE: WriteFailureKinds.INDETERMINATE,
} as const;
export type EveryPushResultKind = ValueOf<typeof EveryPushResultKinds>;

export interface EveryPushResult {
  readonly kind: EveryPushResultKind;
}

/** What each answer announces; `undefined` where the card swap speaks instead. */
export type RegenerateNoticeKeys = Readonly<
  Record<RegenerateResultKind, TranslationKey | undefined>
>;
