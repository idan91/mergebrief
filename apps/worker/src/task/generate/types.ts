import type {
  AnchorPlan,
  AnchorViewInput,
  Brief,
  ContextFetch,
  ContextProvider,
  PrLocator,
  PrMetadata,
  RevisionNarrativeConfig,
  SharedRootDeps,
} from "brief-core";
import type { ArtifactIssue, StoredBrief } from "brief-core/artifact";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type {
  Anchor,
  Effort,
  FullRegeneration,
  Generator,
  SpendPolicy,
} from "generators";
import type { Logger } from "logging";
import type {
  AppDatabase,
  ArtifactStore,
  BriefRowId,
  BriefSpanRow,
  GenerationProjection,
  GenerationTarget,
  PullRequestRow,
  TenantRepository,
} from "persistence";
import type { GitHubApiError, PullRequestFile, PullRequestInfo } from "github";
import type { Result, ValueOf } from "types/utils";
import type { EntryCommentLink } from "../entry-comment";
import type { AcquiredRepoConfig } from "../repo-config";
import type { GitHubPort, PullRequestSource } from "../github-port";

/** The message-only log shape brief-core and the generators contract take. */
export type CoreMessageLog = (message: string) => void;

/** graphile's `Task` shape; tests call it directly with a payload. */
export type GenerateTask = (
  payload: unknown,
  helpers?: GenerateTaskHelpers,
) => Promise<void>;

/** The provider/model/effort columns every generated artifact row carries. */
export interface GenerationOrigin {
  provider: string;
  model: string;
  effort: string;
}

export interface GenerateTaskDeps {
  readonly handle: AppDatabase;
  readonly generator: Generator;
  readonly github: GitHubPort;
  /** The web deployment's public origin, the Entry comment's deep-link base. */
  readonly publicBaseUrl: string;
  /** Head-poll cadence during streaming; default ~20s. */
  readonly headPollIntervalMs?: number;
  /** Instance-config reasoning effort; absent → engine default. */
  readonly effort?: Effort;
  /** Cross-revision regeneration policy; absent → `never` (anchored). */
  readonly fullRegeneration?: FullRegeneration;
  /**
   * The instance daily generation cap; absent → uncapped, which is also what
   * a config file with no `spend` block means.
   */
  readonly spend?: SpendPolicy;
  /** The context providers main.ts built; absent → the built-ins only. */
  readonly contextProviders?: readonly ContextProvider[];
  /** What main.ts offers every tracker's read; GitHub's transport is bound per job. */
  readonly trackerRoot?: SharedRootDeps;
  /** The revision-narrative gate main.ts read; absent means enabled. */
  readonly revisionNarrative?: RevisionNarrativeConfig;
  /** The huge-span ratio main.ts read; absent means the default. */
  readonly hugeSpanRatio?: number;
  readonly log?: Logger;
}

/**
 * The slice of graphile's task helpers this task consumes: the GRACEFUL-
 * SHUTDOWN abort signal (fired on SIGTERM/SIGINT so a minutes-long stream
 * stops instead of riding out compose's kill grace into a ~4h-locked job).
 */
export interface GenerateTaskHelpers {
  readonly abortSignal?: AbortSignal;
  /**
   * The slice of graphile's `Job` row the failure events read (snake_case,
   * graphile's own column shape rides through structurally). `attempts`
   * INCLUDES the in-flight attempt; the retries-exhausted event is minted at
   * `attempts === max_attempts` because graphile has none of its own.
   */
  readonly job?: {
    readonly attempts: number;
    readonly max_attempts: number;
    /** When graphile made the job runnable; the queue wait counts from here. */
    readonly run_at: Date;
  };
}

/**
 * Share one controller between pre-call head checks and streaming head polls.
 * Abort only on confirmed supersession to stop output spend; failed polls are best-effort.
 */
export interface SupersessionWatch {
  readonly signal: AbortSignal;
  /** Throws `SupersededSignal` (after aborting) when the head moved. */
  assertCurrent(): Promise<void>;
  /** The newer PR the abort was based on, the successor, already read. */
  getObserved(): PullRequestInfo | undefined;
  startPolling(): void;
  stop(): void;
}

/** Anchor stamp → brief row columns; `reason` exists exactly on fresh-restart. */
export interface AnchorColumns {
  anchorState: Anchor["state"];
  anchorReason?: string;
}

/** A span diff already fetched this run, reused, never re-fetched. */
export interface PrefetchedSpan {
  readonly baselineSha: string;
  readonly diff: string;
  /** Marks for this span were already written this run. */
  readonly marksWritten: boolean;
}

export interface RevisionArtifactInputs {
  readonly store: ArtifactStore;
  /** The revision-narrative gate main.ts read; absent means enabled. */
  readonly revisionNarrative?: RevisionNarrativeConfig | undefined;
  /** The huge-span ratio main.ts read; absent means the default. */
  readonly hugeSpanRatio?: number | undefined;
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  /** The prevHead...head compare diff, fetched once by the caller. */
  readonly revDiff: string;
  readonly prevBrief: BriefSpanRow;
  readonly briefRef: BriefRef;
  /** Present only when THIS run generated the brief (narrative needs it). */
  readonly generatedBrief: Brief | undefined;
  /** Signal-wrapped generator + the supersession watch gating its calls. */
  readonly generator: Generator;
  readonly watch: SupersessionWatch;
  /** Instance-config reasoning effort; undefined → engine default. */
  readonly effort: Effort | undefined;
  readonly wholePrChangedLines: number;
  readonly loadContext: TicketContextLoader;
  readonly log: Logger;
}

export interface CheckpointDeltasInputs {
  readonly store: ArtifactStore;
  /** The huge-span ratio main.ts read; absent means the default. */
  readonly hugeSpanRatio?: number | undefined;
  readonly repo: TenantRepository;
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  readonly source: PullRequestSource;
  readonly priorBriefs: readonly BriefSpanRow[];
  /** The prevHead...head span already fetched (and marks written) this run. */
  readonly prevSpan: PrefetchedSpan | undefined;
  /** Signal-wrapped generator + the supersession watch gating its calls. */
  readonly generator: Generator;
  readonly watch: SupersessionWatch;
  /** Instance-config reasoning effort; undefined → engine default. */
  readonly effort: Effort | undefined;
  readonly briefHeadIndex: number;
  readonly wholePrChangedLines: number;
  readonly loadContext: TicketContextLoader;
  readonly log: Logger;
}

export interface AnchorDecisionInputs {
  readonly store: ArtifactStore;
  readonly source: PullRequestSource;
  /** Cross-revision regeneration policy; absent → `never` (anchored). */
  readonly fullRegeneration: FullRegeneration | undefined;
  /** The raw generator: `origin()` is pure metadata, no signal needed. */
  readonly generator: Generator;
  readonly effort: Effort | undefined;
  /** The previous briefed head, or undefined on the PR's first brief. */
  readonly prevBrief: BriefSpanRow | undefined;
  readonly priorBriefs: readonly BriefSpanRow[];
  /** The prevHead...head compare diff Result, fetched once by the caller. */
  readonly prevSpanFetch: Result<string, GitHubApiError> | undefined;
  /** This run's PR base. */
  readonly baseSha: string;
  readonly log: Logger;
}

export interface AnchorDecision {
  readonly anchor: Anchor;
  /** Present only when the run anchors; drives the post-generation stitch. */
  readonly anchorPlan: AnchorPlan | undefined;
  readonly anchorView: AnchorViewInput | undefined;
  /** Every group id the PR's chain has used, resolved even on a fresh restart. */
  readonly chainGroupIds: readonly string[];
}

export interface EntryCommentManagerInputs {
  readonly source: PullRequestSource;
  readonly repo: TenantRepository;
  /** The row as read at job start; its entryCommentId seeds the live id. */
  readonly prRow: PullRequestRow;
  readonly publicBaseUrl: string;
  readonly log: Logger;
}

/** The four operations over one live Entry comment id, plus a read of it. */
export interface EntryCommentManager {
  getCurrentId(): bigint | null;
  buildDeepLink(headIndex: number): EntryCommentLink;
  remove(): Promise<void>;
  matches(body: string): Promise<boolean>;
  refresh(body: string): Promise<void>;
}

/**
 * What the run learned that its failure handling must honour. A run over a
 * succeeded row adds no attempt, so neither a failure nor a supersession
 * marks that row; the fresh path clears the flag once it claims the row.
 */
export interface RunState {
  leaveRow: boolean;
}

export interface JobFailureInputs {
  readonly deps: GenerateTaskDeps;
  readonly projection: GenerationProjection;
  readonly target: GenerationTarget;
  /** Leave the generation row untouched: the run was over a stored brief. */
  readonly leaveRow: boolean;
  /** graphile's job row slice; absent on direct test invocations. */
  readonly job: GenerateTaskHelpers["job"];
  readonly log: Logger;
}

export interface SpendGateInputs {
  readonly deps: GenerateTaskDeps;
  readonly projection: GenerationProjection;
  readonly target: GenerationTarget;
  readonly prRow: PullRequestRow;
  /** The row's slug after the usable-slug guard narrowed it. */
  readonly repoSlug: string;
  readonly entryCommentManager: EntryCommentManager;
  readonly job: GenerateTaskHelpers["job"];
  readonly log: Logger;
}

export interface PrMetadataInputs {
  readonly prInfo: PullRequestInfo;
  /** Mutable because brief-core's PrMetadata.files is. */
  readonly files: PullRequestFile[];
  readonly prRow: PullRequestRow;
  /** The open-PR list Result; a failure logs and skips the stack. */
  readonly openPullRequests: Result<OpenPullRequest[], GitHubApiError>;
  readonly log: Logger;
}

/** The stack write after the metadata build: the row, what was attached, when. */
export interface RecordStackInputs {
  readonly repo: TenantRepository;
  readonly prRow: PullRequestRow;
  readonly meta: PrMetadata;
  readonly log: Logger;
  readonly now: Date;
}

/** The ticket context, loaded on first use so a rerun that spends nothing fetches nothing. */
export type TicketContextLoader = () => Promise<ContextFetch>;

export interface TicketContextInputs {
  readonly deps: GenerateTaskDeps;
  readonly source: PullRequestSource;
  readonly prInfo: PullRequestInfo;
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  /** Already acquired for fresh runs and draft drains; the loader fetches it otherwise. */
  readonly repoConfig: AcquiredRepoConfig | undefined;
  readonly coreMessageLog: CoreMessageLog;
  readonly log: Logger;
}

export interface BriefRef {
  readonly id: BriefRowId;
  readonly headIndex: number;
}

export interface BriefGenerationInputs {
  /** Cross-revision regeneration policy; absent → `never` (anchored). */
  readonly fullRegeneration: FullRegeneration | undefined;
  /** The RAW generator, for the anchor decision's `origin()` read only. */
  readonly anchorGenerator: Generator;
  readonly effort: Effort | undefined;
  readonly store: ArtifactStore;
  readonly source: PullRequestSource;
  readonly projection: GenerationProjection;
  readonly target: GenerationTarget;
  readonly entryCommentManager: EntryCommentManager;
  readonly entryCommentAllowed: boolean;
  readonly priorBriefs: readonly BriefSpanRow[];
  readonly prevBrief: BriefSpanRow | undefined;
  /** The prevHead...head compare diff Result, fetched once by the caller. */
  readonly prevSpanFetch: Result<string, GitHubApiError> | undefined;
  readonly prInfo: PullRequestInfo;
  readonly files: readonly PullRequestFile[];
  readonly diff: string;
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  readonly repoConfig: AcquiredRepoConfig | undefined;
  readonly loadContext: TicketContextLoader;
  /** The signal-bound generator: the model call must honour the watch's abort. */
  readonly generator: Generator;
  readonly coreMessageLog: CoreMessageLog;
  readonly log: Logger;
}

export interface GeneratedBrief {
  readonly briefRef: BriefRef;
  /** The stamped brief this run generated. */
  readonly generatedBrief: Brief;
}

export interface StoredBriefRecoveryInputs {
  readonly store: ArtifactStore;
  readonly prevBrief: BriefSpanRow | undefined;
  readonly baseSha: string;
  readonly log: Logger;
}

export const BriefRecoveryFailures = {
  UNREADABLE: "unreadable",
  INCOMPLETE: "incomplete",
} as const;
export type BriefRecoveryFailure = ValueOf<typeof BriefRecoveryFailures>;

/** A failure carries the reader's issues, already logged. */
export type StoredBodyRecovery = Result<StoredBrief, ArtifactIssue[]>;
export type CompleteBriefRecovery = Result<Brief, BriefRecoveryFailure>;

export type AllowedRiskNames = readonly string[];

export interface EntryCommentGateInputs {
  readonly prInfo: PullRequestInfo;
  readonly repoConfig: AcquiredRepoConfig | undefined;
  readonly entryCommentManager: EntryCommentManager;
  readonly log: Logger;
}

export interface ReadyEntryInputs {
  readonly prInfo: PullRequestInfo;
  readonly source: PullRequestSource;
  readonly entryCommentAllowed: boolean;
  readonly log: Logger;
}
