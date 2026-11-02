import type {
  Brief,
  ContextFetch,
  ContextProvider,
  MultiCallHooks,
  PrLocator,
  PrMetadata,
  PreviousBriefInput,
  RevisionNarrativeConfig,
  SharedRootDeps,
} from "brief-core";
import type { ArtifactIssue, StoredBrief } from "brief-core/artifact";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type { PrSpan, PrSpanResult } from "brief-core/pr-span";
import type {
  Anchor,
  Effort,
  FullRegeneration,
  Generator,
  SpendPolicy,
} from "generators";
import type { TFunction } from "i18next";
import type { Logger } from "logging";
import type {
  AppDatabase,
  ArtifactStore,
  AuditEntry,
  BriefRowId,
  BriefSpanRow,
  GenerationFailure,
  GenerationPartStore,
  GenerationProjection,
  GenerationRow,
  GenerationTarget,
  PullRequestRow,
  PullRequestRowId,
  SpanBaseRefs,
  TenantRepository,
} from "persistence";
import type {
  GitHubCallFailure,
  PullRequestFile,
  PullRequestInfo,
} from "github";
import { GenerationStatuses } from "types/generations";
import type { Result, ValueOf } from "types/utils";
import type { EntryCommentLink } from "../entry-comment/types";
import type { AcquiredRepoConfig } from "../repo-config";
import type { GitHubPort, PullRequestSource } from "../github-port";
import type { ParsedGeneratePayload } from "../payload";

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
  /** The catalog's `t`, the Entry comment bodies' copy. */
  readonly translate: TFunction;
  /** Head-poll cadence during streaming; default ~20s. */
  readonly headPollIntervalMs?: number;
  /** Instance-config reasoning effort; absent → engine default. */
  readonly effort?: Effort;
  /** Cross-revision regeneration policy; absent → `never` (anchored). */
  readonly fullRegeneration?: FullRegeneration;
  /**
   * The instance daily generation cap; absent → uncapped. Only test
   * harnesses omit it: a config file with no `spend` block means 300.
   */
  readonly spend?: SpendPolicy;
  /** The context providers main.ts built from the instance's `linkFetch` policy. */
  readonly contextProviders: readonly ContextProvider[];
  /** What main.ts offers every tracker's read; GitHub's transport is bound per job. */
  readonly trackerRoot?: SharedRootDeps;
  /** The instance's `siblingRepos`; absent means off: an installation job reads its own repo and `issuesRepo` only. */
  readonly siblingRepos?: boolean;
  /** The revision-narrative gate main.ts read; absent means enabled. */
  readonly revisionNarrative?: RevisionNarrativeConfig;
  /** The huge-span ratio main.ts read; absent means the default. */
  readonly hugeSpanRatio?: number;
  /** Detail calls a multi-call run keeps in flight at once; absent means `DEFAULT_DETAIL_CONCURRENCY`. */
  readonly detailConcurrency?: number;
  /** The instance's `force-multi-call` switch: every brief runs multi-call; absent means off. */
  readonly forceMultiCall?: boolean;
  readonly log?: Logger;
}

/** The slot pool a job's runner drains: the large pool runs the multi-call runs. */
export const RunPools = {
  NORMAL: "normal",
  LARGE: "large",
} as const;
export type RunPool = ValueOf<typeof RunPools>;

export interface GenerateTaskOptions {
  /** The pool the task's runner drains; absent means the normal pool. */
  readonly pool?: RunPool;
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

/** Renews the run's claim, if it holds one; false once another run holds the row. */
export type ClaimRenewer = () => Promise<boolean>;

/**
 * Charges the run to the daily cap before a paid call; throws
 * `SpendCappedSignal` at the cap. A no-op once charged, or for a claimed run.
 */
export type SpendCharge = () => Promise<void>;

/** What the default branch's `.gitattributes` read answered. */
export const GitAttributesReadings = {
  CONTENT: "content",
  /** Absent, over the cap or refused for good: every file is read in full, and the digest is the empty file's. */
  NONE: "none",
  /** A failure a retry may clear: the file may say anything. */
  UNREAD: "unread",
} as const;

export interface GitAttributesContent {
  readonly kind: typeof GitAttributesReadings.CONTENT;
  readonly text: string;
}

export interface GitAttributesNone {
  readonly kind: typeof GitAttributesReadings.NONE;
}

export interface GitAttributesUnread {
  readonly kind: typeof GitAttributesReadings.UNREAD;
  readonly error: string;
}

export type GitAttributesRead =
  | GitAttributesContent
  | GitAttributesNone
  | GitAttributesUnread;

export const HeadReadings = {
  CURRENT: "current",
  MOVED: "moved",
  /** GitHub did not answer: the head may have moved. */
  UNREAD: "unread",
} as const;

export interface CurrentHeadRead {
  readonly kind: typeof HeadReadings.CURRENT;
}

export interface MovedHeadRead {
  readonly kind: typeof HeadReadings.MOVED;
}

export interface UnreadHeadRead {
  readonly kind: typeof HeadReadings.UNREAD;
  /** Why the read gave no head. */
  readonly error: string;
}

/** One fresh read of the PR's head against this run's. */
export type HeadRead = CurrentHeadRead | MovedHeadRead | UnreadHeadRead;

/**
 * Share one controller between pre-call head checks and streaming head polls.
 * Abort only on confirmed supersession or a lost claim; failed polls are
 * best-effort. Once pinned, a moved head is recorded and never aborts: the
 * run finishes on its head, its Entry posts stand down, the lease renews on.
 */
export interface SupersessionWatch {
  readonly signal: AbortSignal;
  /** Throws `SupersededSignal` (after aborting) when the head moved and the watch is not pinned. */
  assertCurrent(): Promise<void>;
  /** A fresh head read, pinned or not; `moved` aborts unless pinned, a lost claim throws `ClaimLostSignal`. */
  readHead(): Promise<HeadRead>;
  /** The newer PR a moved read saw, the successor, already read. */
  getObserved(): PullRequestInfo | undefined;
  /** From here a moved head no longer ends the run; a lost claim still does. */
  pin(): void;
  isPinned(): boolean;
  startPolling(): void;
  stop(): void;
}

/** Anchor stamp → brief row columns; `reason` exists exactly on fresh-restart. */
export interface AnchorColumns {
  anchorState: Anchor["state"];
  anchorReason?: string;
}

export const MarksStates = {
  ABSENT: "absent",
  /** Written from the refs resolved now: the key's narrative and delta are current too. */
  CURRENT: "current",
  /** Written from other refs: a same-head retarget or a returning head moved the span. */
  STALE: "stale",
} as const;
export type MarksState = ValueOf<typeof MarksStates>;

export const MarksDuties = {
  /** The key's marks hold this span's refs, stored already or written beside the narrative; a delta written under the key rewrites them. */
  CURRENT: "current",
  /** A checkpoint shares the key and a delta is stored under it: the delta step rewrites that delta first, then writes the marks. */
  AFTER_SHARED_DELTA: "after-shared-delta",
  /** The narrative failed over stale refs, or the stored brief could not be read back: no marks, and the delta step leaves the key on its old refs. */
  WITHHELD: "withheld",
  /** A checkpoint's own key: its delta step writes the marks after the delta. */
  OWN: "own",
} as const;
export type MarksDuty = ValueOf<typeof MarksDuties>;

/** A revision span already read this run, reused, never re-read. */
export interface FetchedSpan {
  readonly baselineSha: string;
  readonly span: PrSpan;
  /** The bases the span was read against; its marks row stores them. */
  readonly refs: SpanBaseRefs;
  /** Who writes this key's marks; they never certify a core computed from other bases. */
  readonly marksDuty: MarksDuty;
}

/** A span the run could not read: no later step asks again. */
export interface UnreadSpan {
  readonly baselineSha: string;
  readonly unread: true;
  /** The span is past what GitHub renders or the span bound allows; the commits still exist. */
  readonly diffTooLarge: boolean;
}

export type PrefetchedSpan = FetchedSpan | UnreadSpan;

/** An earlier head a revision span starts from, with the base its own Brief was read against. */
export interface SpanBaseline {
  readonly headSha: string;
  readonly baseSha: string;
}

/** Reads the span from `baseline` to the run's head; a failure a retry may clear throws while one follows. */
export type RevisionSpanReader = (
  baseline: SpanBaseline,
) => Promise<PrSpanResult>;

export interface RevisionArtifactInputs {
  readonly store: ArtifactStore;
  /** The revision-narrative gate main.ts read; absent means enabled. */
  readonly revisionNarrative?: RevisionNarrativeConfig | undefined;
  /** The huge-span ratio main.ts read; absent means the default. */
  readonly hugeSpanRatio?: number | undefined;
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  /** The revision span from the previous briefed head, read once by the caller. */
  readonly span: PrSpan;
  /** The bases `span` was read against. */
  readonly refs: SpanBaseRefs;
  /** A reviewer's checkpoint sits at the previous briefed head, so a checkpoint delta shares this span's key. */
  readonly checkpointSharesSpan: boolean;
  readonly prevBrief: BriefSpanRow;
  readonly briefRef: BriefRef;
  /** Present only when THIS run generated the brief (narrative needs it). */
  readonly generatedBrief: Brief | undefined;
  /** Signal-wrapped generator + the supersession watch gating its calls. */
  readonly generator: Generator;
  readonly watch: SupersessionWatch;
  /** Every signal the generator's calls carry: the watch's and the worker's shutdown. */
  readonly stops: readonly (AbortSignal | undefined)[];
  readonly chargeSpend: SpendCharge;
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
  /** Each distinct checkpoint SHA but the run's head, the revision span's key first. */
  readonly baselineShas: readonly string[];
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  readonly source: PullRequestSource;
  readonly priorBriefs: readonly BriefSpanRow[];
  /** The prevHead...head span already read this run, with who writes its key's marks. */
  readonly prevSpan: PrefetchedSpan | undefined;
  readonly readSpan: RevisionSpanReader;
  /** The PR's current base: a checkpoint no Brief was written at is read against it. */
  readonly baseSha: string;
  /** Signal-wrapped generator + the supersession watch gating its calls. */
  readonly generator: Generator;
  readonly watch: SupersessionWatch;
  readonly chargeSpend: SpendCharge;
  /** Instance-config reasoning effort; undefined → engine default. */
  readonly effort: Effort | undefined;
  readonly briefHeadIndex: number;
  readonly wholePrChangedLines: number;
  /** The run's abort sources: a lockfile read stops with them. */
  readonly stops: readonly (AbortSignal | undefined)[];
  readonly loadContext: TicketContextLoader;
  /** The run's brief origin, which a span's skip record is stamped with. */
  readonly loadBriefOrigin: BriefOriginLoader;
  readonly log: Logger;
}

export type BriefOriginLoader = () => Promise<GenerationOrigin>;

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
  readonly prevSpanFetch: Result<string, GitHubCallFailure> | undefined;
  /** This run's PR base. */
  readonly baseSha: string;
  readonly log: Logger;
}

export interface AnchorDecision {
  readonly anchor: Anchor;
  /** Present only when the run anchors; brief-core plans and stitches from it. */
  readonly previous: PreviousBriefInput | undefined;
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

export const LiveBodyKinds = {
  /** No comment is tracked, or the tracked one is gone. */
  NONE: "none",
  READ: "read",
  /** The read failed: what the thread holds is unknown. */
  UNREAD: "unread",
} as const;

export interface NoLiveBody {
  readonly kind: typeof LiveBodyKinds.NONE;
}

export interface ReadLiveBody {
  readonly kind: typeof LiveBodyKinds.READ;
  readonly body: string;
}

export interface UnreadLiveBody {
  readonly kind: typeof LiveBodyKinds.UNREAD;
  /** GitHub refused the read for good (404, 401, 403): a retry meets the same answer. */
  readonly refused: boolean;
}

/** What the tracked Entry comment holds on GitHub right now. */
export type LiveBody = NoLiveBody | ReadLiveBody | UnreadLiveBody;

export const EntryWrites = {
  /** This run's comment now holds the body. */
  WRITTEN: "written",
  /** Nothing to write: the body is live already, the thread is another body's, or the row is gone. */
  LEFT: "left",
  /**
   * Another writer's comment holds the row: it won the swap, or the row
   * tracks a comment this run never read. Its body may be stale, so only a
   * render from freshly read facts settles the thread.
   */
  CONFLICTED: "conflicted",
  /** A read, delete or post failed in a way a retry may clear; the thread is not known to hold the body. */
  FAILED: "failed",
  /** GitHub refused the delete or post for good (404, 401, 403): a retry meets the same answer. */
  REFUSED: "refused",
} as const;
export type EntryWrite = ValueOf<typeof EntryWrites>;

/** Whether a live Entry body is one a post may replace. */
export type LiveBodyMatcher = (body: string) => boolean;

/** The operations over one live Entry comment id, plus a read of it. */
export interface EntryCommentManager {
  getCurrentId(): bigint | null;
  buildDeepLink(headIndex: number): EntryCommentLink;
  remove(): Promise<void>;
  matches(body: string): Promise<boolean>;
  refresh(body: string): Promise<EntryWrite>;
  /**
   * Rewrite the live comment's body in place, which notifies nobody. With
   * no comment tracked, or the tracked one gone, it posts as `refresh` does.
   */
  edit(body: string): Promise<EntryWrite>;
  /**
   * Post `body` when no comment is live and the PR row names none another
   * run posted, or over a live one `isReplaceable` accepts; a live
   * `body` is left unpinged and any other live body stays. A live body whose
   * read failed is left as well, and reported failed.
   */
  replaceOrCreate(
    body: string,
    isReplaceable: LiveBodyMatcher,
  ): Promise<EntryWrite>;
  /** As `replaceOrCreate`, except no comment is created when none is live. */
  replace(body: string, isReplaceable: LiveBodyMatcher): Promise<EntryWrite>;
}

/**
 * What the run learned that its failure handling must honour. A run over a
 * succeeded or awaiting-trigger row adds no attempt, so neither a failure nor
 * a supersession marks that row; the fresh path clears the flag once it
 * claims the row.
 */
export interface RunState {
  leaveRow: boolean;
  /** The claim's run id once the run holds the row; every later row write names it. */
  runId?: string;
  /** Which of the head's claims this run holds, set with `runId`. */
  attempt?: number;
  /** Model calls this run made through its generator. */
  providerCalls: number;
  /** The Entry gate once the run inputs resolved it; a later failure reuses it. */
  entryCommentAllowed?: boolean;
  /**
   * The run stands on the pair's stored brief without a claim: however it
   * ends with no retry to follow, the row settles `succeeded`.
   */
  standsOnStoredBrief?: boolean;
}

/** The audit row's world: an owner-world row carries no installation. */
export type AuditScope = Pick<AuditEntry, "installationId" | "source">;

/** What the task hands a run before any read. */
export interface RunStart {
  readonly deps: GenerateTaskDeps;
  readonly payload: ParsedGeneratePayload;
  readonly target: GenerationTarget;
  readonly projection: GenerationProjection;
  readonly run: RunState;
  readonly log: Logger;
  /** graphile's job row slice; absent on direct test invocations. */
  readonly job: GenerateTaskHelpers["job"];
  readonly shutdownSignal: AbortSignal | undefined;
  /** The pool this job runs in; a normal-pool run predicting multi-call moves to the large one. */
  readonly pool: RunPool;
  /**
   * A recovery job's run: it claims the row even over a stored brief and
   * follows a live holder by moving its own job. Its claim queues the next
   * recovery job, which ends this job's own retries, so a takeover owing a
   * retry hands the row back to that job instead.
   */
  readonly recovering: boolean;
}

/** The run once its row passed the guards and its source opened. */
export interface RunScope extends RunStart {
  readonly repo: TenantRepository;
  readonly store: ArtifactStore;
  /** A multi-call run's stored parts under the brief's span. */
  readonly parts: GenerationPartStore;
  readonly auditScope: AuditScope;
  readonly prRow: PullRequestRow;
  /** The row's slug after the usable-slug guard narrowed it. */
  readonly repoSlug: string;
  /** The generation row as pickup found it, before this run marked it. */
  readonly projected: GenerationRow | undefined;
  /** Taken before the source opens; the stale-projection sweep counts from it. */
  readonly pickedUpAt: Date;
  readonly source: PullRequestSource;
  readonly entryCommentManager: EntryCommentManager;
}

/** Built once, after the first GitHub read; every later step takes it. */
export interface RunContext extends RunScope {
  readonly prInfo: PullRequestInfo;
  readonly priorBriefs: readonly BriefSpanRow[];
  /** The stored brief for this base and head pair. */
  readonly existingBrief: BriefSpanRow | undefined;
  /** The latest brief of an earlier head, the revision span's baseline. */
  readonly prevBrief: BriefSpanRow | undefined;
  readonly watch: SupersessionWatch;
}

export const RunDecisionKinds = {
  STORED_BRIEF: "stored-brief",
  FRESH: "fresh",
  CAPPED: "capped",
  STAND_DOWN: "stand-down",
} as const;

/** No stored brief: the run claimed the row and started under the cap. */
export interface FreshRun {
  readonly kind: typeof RunDecisionKinds.FRESH;
  readonly runId: string;
}

/** The pair's brief is stored: no brief generation, the row stays as found. */
export interface StoredBriefRun {
  readonly kind: typeof RunDecisionKinds.STORED_BRIEF;
  readonly storedBrief: BriefSpanRow;
}

/** Refused at the cap; a stored brief still owes its ready Entry. */
export interface CappedRun {
  readonly kind: typeof RunDecisionKinds.CAPPED;
  readonly storedBrief: BriefSpanRow | undefined;
}

/** Another run holds the row or already finished it; this one leaves it as found. */
export interface StandDownRun {
  readonly kind: typeof RunDecisionKinds.STAND_DOWN;
}

export const AuthorGateKinds = {
  PROCEED: "proceed",
  /** The PR waits for a collaborator's Trigger approval; the run ends here. */
  AWAITING_TRIGGER: "awaiting-trigger",
} as const;

/** The run may claim; a listed bot's run carries the config the gate read. */
export interface ProceedingRun {
  readonly kind: typeof AuthorGateKinds.PROCEED;
  readonly repoConfig: AcquiredRepoConfig | undefined;
}

/** Nothing was claimed, recorded or spent. */
export interface AwaitingTriggerRun {
  readonly kind: typeof AuthorGateKinds.AWAITING_TRIGGER;
}

export type AuthorGateOutcome = ProceedingRun | AwaitingTriggerRun;

export type GeneratingRun = FreshRun | StoredBriefRun;
export type RunDecision = GeneratingRun | CappedRun | StandDownRun;

/** What every artifact this run writes is built from, read before the brief. */
export interface RunInputs {
  readonly files: readonly PullRequestFile[];
  readonly diff: string;
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  /** The prevHead...head compare diff Result, fetched before the model call; anchoring reads it. */
  readonly prevSpanFetch: Result<string, GitHubCallFailure> | undefined;
  /** The revision span on the PR's own diffs, read before the model call. */
  readonly prevSpanRead: PrSpanResult | undefined;
  readonly repoConfig: AcquiredRepoConfig | undefined;
  readonly loadContext: TicketContextLoader;
  readonly entryCommentAllowed: boolean;
  readonly coreMessageLog: CoreMessageLog;
}

/** The brief the run stands on; a stored body that does not recover has none. */
export interface ProducedBrief {
  readonly briefRef: BriefRef;
  readonly generatedBrief: Brief | undefined;
}

export interface JobFailureInputs {
  readonly deps: GenerateTaskDeps;
  readonly projection: GenerationProjection;
  readonly target: GenerationTarget;
  /** Leave the generation row untouched: the run was over a stored brief. */
  readonly leaveRow: boolean;
  /** The claim's run id; absent before the claim, when unclaimed marks apply. */
  readonly runId: string | undefined;
  /** A recovery job's run: a takeover's retry is its successor recovery job. */
  readonly recovering: boolean;
  /** graphile's job row slice; absent on direct test invocations. */
  readonly job: GenerateTaskHelpers["job"];
  /** Queues the head's Entry sync; called before a failure no retry follows is written. */
  readonly queueEntrySync: () => Promise<void>;
  readonly log: Logger;
}

/** `generation.complete`'s outcome: a call the caller turns into a skip record is no failure. */
export const GeneratorCallOutcomes = {
  SUCCEEDED: GenerationStatuses.SUCCEEDED,
  FAILED: GenerationStatuses.FAILED,
  SKIPPED: "skipped",
} as const;
export type GeneratorCallOutcome = ValueOf<typeof GeneratorCallOutcomes>;

export interface GeneratorCallOptions {
  /** A call cut at its output cap stores a skip record instead of failing. */
  readonly outputCutIsSkip?: boolean;
}

export const JobFailureOutcomes = {
  /** The fenced write found the row held by another run or gone. */
  CLAIM_LOST: "claim-lost",
  PERMANENT: "permanent",
  RETRYING: "retrying",
  /** Transient, on graphile's last attempt: no retry follows. */
  LAST_ATTEMPT: "last-attempt",
} as const;
export type JobFailureOutcome = ValueOf<typeof JobFailureOutcomes>;

export interface JobFailureReport {
  readonly outcome: JobFailureOutcome;
  /** The failure as classified for the row. */
  readonly failure: GenerationFailure;
  /** True when this failure wrote nothing to the row, which the run must then leave. */
  readonly rowKept: boolean;
}

/** What a failure's row write did. */
export const FailureRecords = {
  WRITTEN: "written",
  /** Nothing written: the run leaves the row, or its status is one no unclaimed mark moves. */
  KEPT: "kept",
  /** Another run holds the row, or it is gone. */
  LOST: "lost",
} as const;
export type FailureRecord = ValueOf<typeof FailureRecords>;

/** How far the run got before it threw; the job's failure handling reads it. */
export interface RunProgress {
  /** Set once the row passed its guards and the source opened. */
  scope?: RunScope;
  /** Set once the first GitHub read built the run. */
  context?: RunContext;
}

export interface SpendGateInputs {
  readonly deps: GenerateTaskDeps;
  readonly projection: GenerationProjection;
  readonly target: GenerationTarget;
  readonly recovering: boolean;
  /** The pair's stored brief, when a claimed run stands on one. */
  readonly existingBrief: BriefSpanRow | undefined;
  readonly pickedUpAt: Date;
  readonly prRow: PullRequestRow;
  /** The row's slug after the usable-slug guard narrowed it. */
  readonly repoSlug: string;
  readonly watch: SupersessionWatch;
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
  readonly openPullRequests: Result<OpenPullRequest[], GitHubCallFailure>;
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
  readonly runId: string;
  readonly watch: SupersessionWatch;
  readonly entryCommentManager: EntryCommentManager;
  readonly entryCommentAllowed: boolean;
  readonly translate: TFunction;
  readonly priorBriefs: readonly BriefSpanRow[];
  readonly prevBrief: BriefSpanRow | undefined;
  /** The prevHead...head compare diff Result, fetched once by the caller. */
  readonly prevSpanFetch: Result<string, GitHubCallFailure> | undefined;
  readonly prInfo: PullRequestInfo;
  readonly diff: string;
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  readonly repoConfig: AcquiredRepoConfig | undefined;
  /** The run's abort sources: a lockfile read stops with them. */
  readonly stops: readonly (AbortSignal | undefined)[];
  readonly loadContext: TicketContextLoader;
  /** The signal-bound generator: the model call must honour the watch's abort. */
  readonly generator: Generator;
  readonly coreMessageLog: CoreMessageLog;
  /** What a multi-call run of this brief needs from the worker. */
  readonly multiCall: MultiCallRunInputs;
  readonly log: Logger;
}

export interface MultiCallRunInputs {
  /** The engine's hooks: units claimed after grouping, parts stored and resumed. */
  readonly hooks: MultiCallHooks;
  /** Deletes the span's stored parts once the brief is written; a failed delete only warns. */
  readonly deleteParts: () => Promise<void>;
  /**
   * Reads the span's parts before any paid call, outside the engine's
   * single-call check, which reads a hook's throw as nothing stored: a store
   * failure, or an unread `.gitattributes` over stored parts, ends the run
   * transient here.
   */
  readonly loadStoredParts: () => Promise<void>;
  /**
   * A permanent failure after every detail part landed is deterministic over
   * the stored parts: they go, so a re-trigger regenerates instead of failing
   * the same way. Any other failure keeps them.
   */
  readonly discardPartsOnMergeFailure: (error: unknown) => Promise<void>;
  /** The default branch's `.gitattributes`, read once per run; absent reads every file in full. */
  readonly gitAttributes: string | undefined;
  readonly detailConcurrency: number | undefined;
  readonly forceMultiCall: boolean | undefined;
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

/** The stored brief a run stands on, and the PR diff its sidecar counts against. */
export interface StoredBriefLayoutInputs {
  readonly store: ArtifactStore;
  readonly pullRequestId: PullRequestRowId;
  readonly storedBrief: BriefSpanRow;
  readonly diff: string;
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
