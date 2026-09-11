/* oxlint-disable house/comment-run -- the projection state model and the idempotency
   contract decide whether a retry re-spends tokens; neither fits eight lines */
// One job = bring this PR's artifacts up to date at this head: the shared brief, the
// mechanical comparison marks and revision narrative when a previous briefed head exists,
// then one pre-warmed delta core per DISTINCT checkpoint SHA, each guarded by the huge-span
// skip. This module owns orchestration only: payload validation, tenancy, idempotent
// skip/reuse, projection transitions and error mapping.
//
// State model (generation projection, kind brief):
// queued to running(phase) to succeeded, failed or superseded.
//   superseded is terminal and NOT a failure: the head advanced past the job's head, or the
//   PR reached a terminal state. No retry, attempts untouched, no salvage or dump.
//   failed is recorded through markFailed, which sanitizes. PERMANENT failures return
//   normally so graphile does not retry a job that cannot succeed; TRANSIENT failures
//   rethrow so graphile's backoff and dead-letter machinery owns the retry.
//
// Idempotency, so a retry never double-spends: the brief is skipped when its (base, head)
// row exists, each delta core is skipped when its (checkpoint, head) row exists, and
// marks/narrative writes are content-addressed upserts.
/* oxlint-enable house/comment-run */
import { APIConnectionError } from "@anthropic-ai/sdk";
import {
  categorize,
  categorizeDelta,
  categorizeRevisionNarrative,
  buildComparisonMarks,
  buildContextQuery,
  countChangedLines,
  createBuiltInContextProviders,
  fetchContextSnippets,
  listReadableTrackers,
  resolveTrackerReads,
  GitHubTransports,
  NotionTransports,
  isHugeSpan,
  parseChangedRanges,
  stitchBrief,
  toPrLifecycleState,
  type AnchorViewInput,
  type ContextFetch,
  type ContextProvider,
  type Brief,
  type SharedRootDeps,
  type TrackerRootDeps,
  type DeltaInput,
  type FetchedPr,
  type PrLocator,
  type PrMetadata,
  type RevisionNarrativeConfig,
  type RevisionNarrativeSkipped,
} from "brief-core";
import {
  AnchorStates,
  capForRepo,
  FreshRestartReasons,
  FullRegenerations,
  GeneratorError,
  GeneratorErrorKinds,
  type Anchor,
  type Effort,
  type FullRegeneration,
  type Generator,
  type SpendPolicy,
} from "generators";
import { enqueueOwnerHeadFollowUp } from "./owner-follow-up";
import {
  StoredIdsSchema,
  createArtifactStore,
  writeAudit,
  AuditOutcomes,
  AuditActorTypes,
  AuditMetadataKeys,
  createTenantRepository,
  isOwnerContext,
  PullRequestSources,
  GenerationFailureCodes,
  createGenerationProjection,
  GenerationKinds,
  GenerationPhases,
  GenerationStatuses,
  PrStates,
  type AppDatabase,
  type ArtifactStore,
  type BriefRowId,
  type BriefSpanRow,
  type BriefWriteInput,
  type GenerationKind,
  type GenerationStatus,
  type GenerationTarget,
  type PullRequestRow,
  type TenantRepository,
} from "persistence";
import { GitHubApiErrorCodes } from "github";
import type { Mutable, Result } from "types";
import {
  entryCommentBody,
  entryCommentCappedBody,
  entryCommentGeneratingBody,
  type EntryCommentLink,
} from "./entry-comment";
import { utcDayBounds } from "./spend";
import {
  splitRepoSlug,
  type GitHubApiError,
  type GitHubPort,
  type PullRequestInfo,
  type PullRequestSource,
} from "./github-port";
import { createInstallationIssueApi } from "./issue-api";
import type { LogFields, Logger } from "logging";
import {
  classifyFailure,
  PermanentJobError,
  TransientJobError,
} from "./failure";
import { parseGeneratePayload, type ParsedGeneratePayload } from "./payload";
import { planAnchoredRun, type AnchoredRun } from "./anchored-run";
import { RepoConfigOutcomes, RepoConfigPaths } from "repo-config";
import {
  acquireRepoConfig,
  buildRepoConfigArtifact,
  buildRepoConfigOrigin,
} from "./repo-config";

// The worker's own `audit_log.operation` token: the job runs off the request
// path, so it names itself rather than a Product Operation descriptor.
const AUDIT_OPERATION_GENERATE = "generate";

// Re-exported for the worker's internal modules and `index.ts`.
export type { Logger };

/** The message-only log shape brief-core and the generators contract take. */
type CoreLog = (message: string) => void;

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

const DEFAULT_HEAD_POLL_INTERVAL_MS = 20_000;

/**
 * Share one controller between pre-call head checks and streaming head polls.
 * Abort only on confirmed supersession to stop output spend; failed polls are best-effort.
 */
interface SupersessionWatch {
  readonly signal: AbortSignal;
  /** Throws `SupersededSignal` (after aborting) when the head moved. */
  assertCurrent(): Promise<void>;
  /** The newer PR the abort was based on, the successor, already read. */
  observed(): PullRequestInfo | undefined;
  startPolling(): void;
  stop(): void;
}

function createSupersessionWatch(
  source: PullRequestSource,
  headSha: string,
  intervalMs: number,
): SupersessionWatch {
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  let seen: PullRequestInfo | undefined;

  async function headMoved(): Promise<boolean> {
    const info = await source.fetchPullRequest();
    if (!info.ok || info.value.headSha === headSha) {
      return false;
    }
    // Retained so the supersession does not have to re-read GitHub to learn
    // the head it is standing down for.
    seen = info.value;
    return true;
  }

  async function pollOnce(): Promise<void> {
    try {
      if (await headMoved()) {
        controller.abort();
      }
    } catch {
      // Poll failures are ignored, the pre-call checks still stand.
    } finally {
      polling = false;
    }
  }

  return {
    signal: controller.signal,
    observed() {
      return seen;
    },
    async assertCurrent() {
      let moved = false;
      try {
        moved = await headMoved();
      } catch {
        // Best-effort check; a fetch failure is not a supersession.
      }
      if (moved) {
        controller.abort();
        throw new SupersededSignal("head advanced (pre-call check)");
      }
    },
    startPolling() {
      timer ??= setInterval(() => {
        if (polling || controller.signal.aborted) {
          return;
        }
        polling = true;
        void pollOnce();
      }, intervalMs);
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

/** Wrap a Generator so every request carries the watch's abort signal. */
function withAbortSignal(generator: Generator, signal: AbortSignal): Generator {
  return {
    generate: (req) => generator.generate({ ...req, signal }),
    origin: (effort) => generator.origin(effort),
  };
}

/** 406 = GitHub refuses to render the diff (too large), permanent per span. */
function isPermanentGitHubError(error: GitHubApiError): boolean {
  return (
    error.code === GitHubApiErrorCodes.NOT_FOUND ||
    error.code === GitHubApiErrorCodes.UNAUTHORIZED ||
    error.code === GitHubApiErrorCodes.FORBIDDEN ||
    error.status === 406
  );
}

/** Unwrap a GitHub `Result`, converting failures into the right error class. */
function unwrapGitHub<T>(result: Result<T, GitHubApiError>): T {
  if (result.ok) {
    return result.value;
  }
  if (isPermanentGitHubError(result.error)) {
    throw new PermanentJobError(result.error.message, {
      failure:
        result.error.status === 406
          ? { code: GenerationFailureCodes.DIFF_TOO_LARGE }
          : { code: GenerationFailureCodes.GITHUB_ACCESS },
    });
  }
  // Transient (rate limit / 5xx / network): rethrown → graphile retries.
  throw new TransientJobError(result.error.message, {
    failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE },
  });
}

/**
 * Treat 429/5xx/408 and SDK APIConnectionError as transient. The latter has no status
 * and a plain Error name, so it needs instanceof. Retrying deterministic schema/refusal
 * failures would spend again without a recovery signal.
 */
function isTransientGenerationError(error: unknown): boolean {
  // Adapters classify their own transport failures: provider-transient is the
  // only kind a retry can help.
  if (error instanceof GeneratorError) {
    return error.kind === GeneratorErrorKinds.PROVIDER_TRANSIENT;
  }
  if (error instanceof APIConnectionError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const status = Reflect.get(error, "status");
  if (typeof status === "number") {
    return status === 408 || status === 429 || status >= 500;
  }
  return false;
}

/**
 * Artifact origin data from the engine's `Generation` metadata. `effort` is
 * null for adapters without an effort knob; the store column is a plain
 * string, so null normalizes to the honest "none".
 */
function getGenerationOrigin(generation: Brief["generation"]): {
  provider: string;
  model: string;
  effort: string;
} {
  return {
    provider: generation.provider,
    model: generation.model,
    effort: generation.effort ?? "none",
  };
}

/** Anchor stamp → brief row columns; `reason` exists exactly on fresh-restart. */
interface AnchorColumns {
  anchorState: Anchor["state"];
  anchorReason?: string;
}

function getAnchorColumns(anchor: Anchor): AnchorColumns {
  const columns: AnchorColumns = { anchorState: anchor.state };

  if (anchor.state === AnchorStates.FRESH_RESTART) {
    columns.anchorReason = anchor.reason;
  }

  return columns;
}

/** The brief-kind projection target the ingest transaction queued. */
function briefTarget(payload: ParsedGeneratePayload): GenerationTarget {
  return {
    pullRequestId: payload.pullRequestId,
    kind: GenerationKinds.BRIEF,
    headSha: payload.headSha,
    baselineSha: null,
  };
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
  };
}

/**
 * Build the generate task. The returned function is graphile's `Task` shape;
 * tests call it directly with a payload (helpers optional).
 */
export function createGenerateTask(
  deps: GenerateTaskDeps,
): (payload: unknown, helpers?: GenerateTaskHelpers) => Promise<void> {
  const log = deps.log ?? noopLogger();

  return async function generate(
    rawPayload: unknown,
    helpers?: GenerateTaskHelpers,
  ): Promise<void> {
    const parsed = parseGeneratePayload(rawPayload);
    if (!parsed.ok) {
      // Poisoned/foreign job: no projection row is addressable, drop it.
      log.warn(`generate: dropping malformed payload — ${parsed.error}`);
      return;
    }
    const payload = parsed.value;
    // The pipeline's correlation key: {prId, headSha} on every job line, the
    // durable join to the webhook leg, since deliveries coalesce and no
    // delivery id owns a job.
    const jobLog = log.child({
      prId: String(payload.pullRequestId),
      headSha: payload.headSha,
    });
    const projection = createGenerationProjection(deps.handle, payload.ctx);
    const target = briefTarget(payload);

    try {
      await runGeneration(deps, payload, target, helpers?.abortSignal, jobLog);
    } catch (error) {
      if (error instanceof SupersededSignal) {
        // Not a failure: terminal `superseded`, attempts untouched, no retry.
        await projection.markSuperseded(target);
        jobLog.info(`generate: superseded (${error.message})`);
        return;
      }
      if (helpers?.abortSignal?.aborted === true) {
        // Graceful shutdown aborted the in-flight work. NOT a supersession
        // (the head didn't move) and NOT a failure (nothing is wrong with the
        // job): leave the projection as-is and rethrow so graphile returns
        // the job to the queue for the next worker.
        jobLog.info("generate: aborted by shutdown — job returns to the queue");
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      await projection.markFailed(target, classifyFailure(error));
      emitProviderError(jobLog, deps, error);
      const permanent = error instanceof PermanentJobError;
      const attempt = helpers?.job?.attempts;
      const maxAttempts = helpers?.job?.max_attempts;
      const failFields: LogFields = { evt: "job.fail", permanent };

      if (attempt !== undefined) failFields["attempt"] = attempt;
      if (maxAttempts !== undefined) failFields["maxAttempts"] = maxAttempts;

      // Message-only: no `err` field, provider cause chains may carry
      // request contents, which the boundary's URL scrub does not cover.
      jobLog.error(
        permanent
          ? `generate: permanent failure — ${message}`
          : `generate: failed (${message}) — handing to graphile for retry`,
        failFields,
      );
      if (
        attempt !== undefined &&
        maxAttempts !== undefined &&
        attempt >= maxAttempts
      ) {
        // THE worker alert: graphile is out of retries for this job.
        jobLog.error("generate: retries exhausted", {
          evt: "job.retries.exhausted",
          attempt,
        });
      }
      if (permanent) {
        // markFailed already recorded it; a graphile retry cannot help.
        return;
      }
      throw error;
    }
  };
}

/** Inert boundary logger for direct test invocations that pass no `log`. */
function noopLogger(): Logger {
  const inert: Logger = {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    child: () => inert,
  };
  return inert;
}

/**
 * Emitted when the failure is a provider call gone wrong, a `GeneratorError`,
 * the SDK's connection error, or any error carrying a numeric HTTP status.
 * Message-only posture: fields carry classification, never the raw error
 * object (cause chains may hold request contents).
 */
function emitProviderError(
  log: Logger,
  deps: GenerateTaskDeps,
  thrown: unknown,
): void {
  // A permanent classification wraps the original throw, read through it.
  const error =
    thrown instanceof PermanentJobError && thrown.cause !== undefined
      ? thrown.cause
      : thrown;
  const status =
    typeof error === "object" && error !== null
      ? Reflect.get(error, "status")
      : undefined;
  const isProviderFailure =
    error instanceof GeneratorError ||
    error instanceof APIConnectionError ||
    typeof status === "number";
  if (!isProviderFailure) {
    return;
  }
  // origin() is pure metadata; any effort yields the same provider name.
  const provider = deps.generator.origin(deps.effort ?? "medium").provider;
  const fields: LogFields = { evt: "provider.error", provider };

  if (typeof status === "number") fields["status"] = status;
  if (error instanceof GeneratorError) fields["kind"] = error.kind;

  log.error(error instanceof Error ? error.message : String(error), fields);
}

/** Control-flow signal: the job's head is no longer the PR's head. */
class SupersededSignal extends Error {}

async function runGeneration(
  deps: GenerateTaskDeps,
  payload: ParsedGeneratePayload,
  target: GenerationTarget,
  shutdownSignal: AbortSignal | undefined,
  log: Logger,
): Promise<void> {
  const { handle, github } = deps;
  const { ctx, pullRequestId, headSha } = payload;
  const repo = createTenantRepository(handle, ctx);
  const projection = createGenerationProjection(handle, ctx);
  const store = createArtifactStore(handle, ctx);
  const auditScope = isOwnerContext(ctx)
    ? { installationId: null, source: PullRequestSources.URL_BOX }
    : {
        installationId: ctx.installationId,
        source: PullRequestSources.APP_INSTALLATION,
      };

  const pr = await repo.pullRequests.getById(pullRequestId);
  if (pr === undefined) {
    // Row purged/never existed: nothing addressable, nothing to mark.
    log.warn(
      `generate: pull_request ${pullRequestId} not in tenant — dropping job`,
    );
    return;
  }
  if (
    payload.grantId === undefined &&
    (pr.state === PrStates.CLOSED || pr.state === PrStates.MERGED)
  ) {
    // App world: a brief for a terminal PR would never be read (same rule as
    // the enqueue gate); the queued projection row must not sit forever.
    // Url-box jobs generate regardless, briefing a merged PR is that door's
    // primary use.
    throw new SupersededSignal(`pull_request ${pr.prNumber} is ${pr.state}`);
  }
  if (pr.repoSlug === null || splitRepoSlug(pr.repoSlug) === undefined) {
    throw new PermanentJobError("pull_request row has no usable repo slug");
  }
  // Re-bind post-guard so the narrowing survives into the inner closure.
  const prRow: PullRequestRow = pr;
  // The Entry comment id rotates up to twice per run (generating → ready);
  // track the live value, the prRow snapshot goes stale after the first
  // rotation, and deleting by a stale id would orphan the newer comment.
  let liveEntryCommentId: bigint | null = prRow.entryCommentId;

  // Bind the GitHub source before the cap so an existing Entry comment can be updated.
  // A url-box binding may itself probe once for PAT fallback; capped jobs pay that read
  // but make no further GitHub reads.
  const source =
    payload.grantId === undefined
      ? await github.openPullRequestSource(
          payload.ctx.installationId,
          pr.repoSlug,
          pr.prNumber,
        )
      : await github.openUrlBoxPullRequestSource(
          payload.grantId,
          pr.repoSlug,
          pr.prNumber,
        );

  // Gate model spend before markRunning so the current attempt cannot count itself.
  // Binding the GitHub source may precede this gate. Count attempts, not rows; capped jobs
  // are terminal skips with no retry or consumed attempt.
  const cap =
    deps.spend === undefined ? null : capForRepo(deps.spend, pr.repoSlug);
  if (cap !== null) {
    const day = utcDayBounds(new Date());
    const started = await projection.countStartedRunsForRepo({
      repoId: prRow.repoId,
      from: day.from,
      to: day.to,
    });
    if (started >= cap) {
      // `prId`/`headSha` ride the child bindings stamped in the task wrapper.
      log.warn("generate: daily generation cap reached — skipping this run", {
        evt: "spend.cap.trip",
        repo: pr.repoSlug,
        cap,
        dayUtc: day.label,
      });
      if (liveEntryCommentId !== null && payload.grantId === undefined) {
        // UPDATE ONLY: a capped PR never gets an Entry comment created for it,
        // the cap must not make MergeBrief louder on a thread than it was.
        await refreshEntryComment(
          entryCommentCappedBody({
            publicBaseUrl: deps.publicBaseUrl,
            repoId: prRow.repoId,
            prNumber: prRow.prNumber,
            headSha,
            resetsAt: day.to,
          }),
        );
      }
      // Do NOT overwrite a `failed` row: an at-cap graphile retry lands here
      // with the previous attempt's real failure recorded, and stamping
      // `capped` over it would erase why the job actually broke.
      const current = await projection.get(target);
      if (current?.status !== GenerationStatuses.FAILED) {
        await projection.markCapped(target);
      }
      return;
    }
  }

  await projection.markRunning(target, GenerationPhases.FETCHING);

  // Installation jobs rely on the newer push webhook. Url-box jobs may have no webhook,
  // so every supersession path must schedule the observed head before standing down.
  const grantId = payload.grantId;
  async function queueObservedHeadForOwner(
    observed?: PullRequestInfo,
  ): Promise<void> {
    if (grantId === undefined) {
      return;
    }
    // A read the caller already has beats a fresh one: the successor is known
    // to exist, and re-reading could fail. `unwrapGitHub` on the fallback is
    // deliberate, a transient failure must RETRY the job rather than finalize
    // `superseded`, which would drop the successor head on the floor.
    const current = observed ?? unwrapGitHub(await source.fetchPullRequest());
    if (current.headSha === headSha) {
      return;
    }
    await enqueueOwnerHeadFollowUp(deps.handle, payload.ctx, {
      prNumber: prRow.prNumber,
      repoId: prRow.repoId,
      grantId,
      info: current,
      log,
    });
  }

  const info = unwrapGitHub(await source.fetchPullRequest());
  if (info.headSha !== headSha) {
    await queueObservedHeadForOwner(info);
    throw new SupersededSignal(
      `head advanced ${headSha.slice(0, 8)} → ${info.headSha.slice(0, 8)}`,
    );
  }
  if (payload.grantId === undefined && info.state !== "open") {
    throw new SupersededSignal(
      `pull_request ${pr.prNumber} is ${info.state} on GitHub`,
    );
  }

  // Pass the watch signal through every model call and check freshness before each artifact.
  // A watch abort is SupersededSignal, never a retried failure or an attempts increment.
  const watch = createSupersessionWatch(
    source,
    headSha,
    deps.headPollIntervalMs ?? DEFAULT_HEAD_POLL_INTERVAL_MS,
  );
  // The generator aborts on EITHER trigger: a superseding push (the watch) or
  // graceful shutdown (graphile's helpers.abortSignal). The two are told
  // apart in `createGenerateTask`'s catch, superseded vs back-to-queue.
  const generatorSignal =
    shutdownSignal === undefined
      ? watch.signal
      : AbortSignal.any([watch.signal, shutdownSignal]);
  const generator = withAbortSignal(deps.generator, generatorSignal);
  try {
    await generateArtifacts();
  } catch (error) {
    // The poller aborting an in-flight SDK call surfaces as its rejection (an
    // APIUserAbortError); that is the abort, not a failure.
    const outcome =
      watch.signal.aborted && !(error instanceof SupersededSignal)
        ? new SupersededSignal("head advanced mid-call (streaming poll)")
        : error;
    if (outcome instanceof SupersededSignal) {
      await queueObservedHeadForOwner(watch.observed());
    }
    throw outcome;
  } finally {
    watch.stop();
  }
  return;

  async function generateArtifacts(): Promise<void> {
    watch.startPolling();
    const files = unwrapGitHub(await source.fetchPullRequestFiles());
    const diff = unwrapGitHub(await source.fetchDiff());

    const locator: PrLocator = locatorFor(prRow);
    const state = toPrLifecycleState(info.state);
    const meta: PrMetadata = {
      title: info.title,
      body: info.body,
      url: info.htmlUrl,
      sha: info.headSha,
      baseSha: info.baseSha,
      commitCount: info.commitCount,
      headRef: info.headRef,
      files,
      draft: info.draft,
      merged: info.merged,
    };

    if (state !== undefined) meta.state = state;
    if (info.baseRef !== undefined) meta.baseRef = info.baseRef;

    const coreLog: CoreLog = (message) => log.info(message);

    // ---- The shared Brief (skip-if-exists: retries never re-spend) ----------
    const priorBriefs = await store.briefs.listForPullRequest(pullRequestId);
    const existing = priorBriefs.find(
      (row) => row.baseSha === info.baseSha && row.headSha === headSha,
    );
    // Previous briefed head = highest-index brief whose head differs (the
    // DB-mode equivalent of the CLI manifest lookup).
    const prevBrief = priorBriefs
      .toReversed()
      .find((row) => row.headSha !== headSha);

    // The anchoring plan needs the prevHead→head span BEFORE the model call;
    // the revision-artifact phase below reuses the same Result (unwrap stays
    // deferred there so a permanent 406 still lands after the brief write).
    const prevSpanFetch =
      prevBrief === undefined
        ? undefined
        : await source.fetchCompareDiff(prevBrief.headSha, headSha);

    let briefRef: { id: BriefRowId; headIndex: number };
    let generatedBrief: Brief | undefined;
    // Fresh default-branch config reads fail open with recorded fetch-failed outcomes.
    // Draft skip drains also need settings for the Entry gate; unavailable settings close it.
    const repoConfig =
      existing === undefined || info.draft
        ? await acquireRepoConfig(source, log)
        : undefined;
    if (repoConfig !== undefined && existing === undefined) {
      // Record config outcomes before generation so failed or superseded runs retain them.
      // A draft skip drain must not overwrite outcomes with config that never shaped the brief.
      await projection.recordRepoConfig(
        target,
        buildRepoConfigOrigin(repoConfig),
      );
    }
    // Load ticket context only when a core needs it, lazily for skip-drain recovery.
    // Resolve the configured tracker with the job's transport and the brief's ticket.
    // Acquire repo config within that lazy load to avoid double fetching ordinary reruns.
    // Never use diff text; fail open per provider and report unreadable tickets without guessing.
    const trackerRoot = deps.trackerRoot ?? { env: {}, contextSources: [] };
    let contextLoad: Promise<ContextFetch> | undefined;
    const loadContext = (): Promise<ContextFetch> => {
      contextLoad ??= fetchTicketContext();
      return contextLoad;
    };
    async function fetchTicketContext(): Promise<ContextFetch> {
      const config = repoConfig ?? (await acquireRepoConfig(source, log));
      // A url-box job runs on the viewer's grant: GitHub stays inside the
      // PR's repo and no deployment credential is offered, so the repo's
      // settings cannot borrow the operator's Notion integration.
      const transports: TrackerRootDeps["transports"] =
        payload.grantId === undefined
          ? {
              github: GitHubTransports.INSTALLATION.create(
                createInstallationIssueApi(source),
              ),
              notion: NotionTransports.HTTP.create(),
            }
          : {
              github: GitHubTransports.INSTALLATION.create(
                createInstallationIssueApi(source),
                { onlyRepo: locator },
              ),
            };
      const reads = resolveTrackerReads(config?.settings?.tracker, {
        ...trackerRoot,
        transports,
      });
      if (!reads.ok) {
        log.warn("generate: tracker read unavailable", {
          issues: reads.error.issues,
        });
      }
      const readable = reads.ok ? listReadableTrackers(reads.value) : [];

      const context = await fetchContextSnippets(
        buildContextQuery({
          title: meta.title,
          body: meta.body,
          branch: info.headRef,
          repo: locator,
          tracker: config?.settings?.tracker,
          readable,
        }),
        deps.contextProviders ?? createBuiltInContextProviders(),
        coreLog,
        { reads: reads.ok ? reads.value : {} },
      );
      const { primaryTicket } = context;
      if (primaryTicket?.status === "unread") {
        const { reference, reason } = primaryTicket;
        log.warn("generate: primary ticket unread", {
          tracker: reference.tracker,
          reason,
          key: reference.key === "" ? reference.url : reference.key,
        });
      } else if (primaryTicket !== undefined) {
        log.debug("generate: primary ticket read", {
          tracker: primaryTicket.snippet.tracker,
          key: primaryTicket.snippet.key,
        });
      }
      return context;
    }
    // Entry comments stay off drafts unless repo settings opt in; generation is independent.
    // The ready_for_review skip drain may later post the ready entry.
    // Url-box credentials must never write to GitHub, so that world has no Entry comments.
    const entryCommentAllowed =
      payload.grantId === undefined &&
      (!info.draft || repoConfig?.settings?.entryCommentOnDrafts === true);
    if (!entryCommentAllowed && payload.grantId === undefined) {
      log.info(
        "generate: entry comment suppressed — draft PR without entryCommentOnDrafts",
      );
      // Delete lingering draft entries only when settings are known to disable them.
      // A settings fetch failure closes posting but cannot justify deleting a valid opt-in comment.
      const settingsUnknown =
        repoConfig?.files.some(
          (file) =>
            file.path === RepoConfigPaths.SETTINGS &&
            file.outcome === RepoConfigOutcomes.FETCH_FAILED,
        ) ?? false;
      if (!settingsUnknown) {
        await removeEntryComment();
      }
    }
    if (existing === undefined) {
      const headIndex = (priorBriefs.at(-1)?.headIndex ?? 0) + 1;
      // Always forces fresh output; on-model-swap restarts when the stamped provider/model differs.
      // Otherwise recover a previous brief for partition/stitch. Missing or unusable rows fall
      // back to fresh generation stamped none.
      const policy = deps.fullRegeneration ?? FullRegenerations.NEVER;
      let anchor: Anchor = { state: AnchorStates.NONE };
      let anchorPlan: AnchoredRun["plan"] | undefined;
      let anchorView: AnchorViewInput | undefined;
      // The chain's used-id set rides ahead of the anchoring decision: even a
      // fresh restart keeps history reserved, or descent could resurrect a
      // retired id for an unrelated group.
      const prevRow =
        prevBrief === undefined
          ? undefined
          : await store.briefs.get(
              pullRequestId,
              prevBrief.baseSha,
              prevBrief.headSha,
            );
      const previousBody =
        prevRow === undefined ? undefined : recoverBrief(prevRow.body, log);
      // The chain reads off the NEWEST prior row, not `prevBrief`, that
      // lookup skips same-head rows, so after a base retarget (same head,
      // new base) it would drop the retargeted row's history for good.
      const chainSource = priorBriefs.at(-1);
      let chainRow = prevRow;
      let chainBody = previousBody;
      if (
        chainSource !== undefined &&
        (chainSource.headSha !== prevBrief?.headSha ||
          chainSource.baseSha !== prevBrief.baseSha)
      ) {
        chainRow = await store.briefs.get(
          pullRequestId,
          chainSource.baseSha,
          chainSource.headSha,
        );
        chainBody =
          chainRow === undefined ? undefined : recoverBrief(chainRow.body, log);
      }
      const chainGroupIds = resolveChainGroupIds(chainRow, chainBody);
      if (prevBrief !== undefined && policy !== FullRegenerations.ALWAYS) {
        const current = deps.generator.origin(deps.effort ?? "medium");
        if (
          policy === FullRegenerations.ON_MODEL_SWAP &&
          prevRow !== undefined &&
          (prevRow.provider !== current.provider ||
            prevRow.model !== current.model)
        ) {
          anchor = {
            state: AnchorStates.FRESH_RESTART,
            reason: FreshRestartReasons.MODEL_SWAP,
          };
          log.info(
            `generate: fresh restart — model swapped (${prevRow.provider}/${prevRow.model} → ${current.provider}/${current.model})`,
          );
        } else if (previousBody !== undefined) {
          const anchored = await planAnchoredRun(payload, {
            store,
            source,
            prevBrief,
            previousBrief: previousBody,
            chainGroupIds,
            prevSpanFetch,
            baseSha: info.baseSha,
            log,
          });
          anchorPlan = anchored.plan;
          anchor = { state: AnchorStates.ANCHORED };
          anchorView = anchored.view;
        }
      }
      await projection.markRunning(target, GenerationPhases.GENERATING);
      // Post the "generating" Entry comment before the (minutes-long) model
      // call: the deep link already renders the diff-first wait UX, so the
      // thread learns a Brief is coming while it is still being produced.
      // Skip-branch reruns never reach here, no generating churn for them.
      if (entryCommentAllowed) {
        await refreshEntryComment(entryCommentGeneratingBody(deepLink()));
      }
      const { links, primaryTicket } = await loadContext();
      const fetchedPr: FetchedPr = { locator, meta, diff, links };
      if (primaryTicket !== undefined) fetchedPr.primaryTicket = primaryTicket;
      const brief = await runGenerator(
        () =>
          categorize(
            fetchedPr,
            headIndex,
            {
              base: info.baseSha,
              head: headSha,
              commitCount: info.commitCount,
            },
            generator,
            coreLog,
            repoConfig?.repoContext,
            deps.effort,
            anchorView,
          ),
        log,
        GenerationKinds.BRIEF,
      );
      await projection.markRunning(target, GenerationPhases.WRITING);
      // Anchored stitch: carry frozen groups verbatim over the model's take,
      // rewrite ids by descent, enforce coverage. A coverage failure is a
      // pipeline error, permanent, never salvage.
      let finalBrief = brief;
      let carriedChunkIds: readonly string[] = [];
      if (anchorPlan !== undefined) {
        const stitched = stitchBrief({
          generated: brief,
          plan: anchorPlan,
          prFiles: files.map((file) => file.path),
          changedFiles: parseChangedRanges(diff),
        });
        if (!stitched.ok) {
          throw new PermanentJobError(stitched.error.message);
        }
        finalBrief = stitched.value.brief;
        carriedChunkIds = stitched.value.carriedChunkIds;
      }
      const stamped: Brief = { ...finalBrief, anchor };
      const briefWrite: Mutable<BriefWriteInput> = {
        pullRequestId,
        baseSha: info.baseSha,
        headSha,
        headIndex,
        commitCount: info.commitCount,
        ...getGenerationOrigin(brief.generation),
        body: JSON.stringify(stamped),
        ...getAnchorColumns(anchor),
        carriedChunkIds,
        usedGroupIds: [
          ...new Set([
            ...chainGroupIds,
            ...stamped.changeGroups.map((group) => group.id),
          ]),
        ],
      };

      if (repoConfig !== undefined) {
        // Fired attributes come from the PERSISTED chunks, the stitched
        // artifact, not the model's raw take, which disagrees on
        // carried/dropped regions.
        briefWrite.repoConfig = buildRepoConfigArtifact(
          repoConfig,
          stamped.chunks,
        );
      }

      const written = await store.briefs.write(briefWrite);
      if (!written.ok) {
        throw new PermanentJobError(written.error.message);
      }
      briefRef = { id: written.value.id, headIndex: written.value.headIndex };
      generatedBrief = stamped;
      await writeAudit(handle, {
        ...auditScope,
        actorType: AuditActorTypes.SYSTEM,
        operation: AUDIT_OPERATION_GENERATE,
        outcome: AuditOutcomes.OK,
        targetType: "brief",
        targetId: briefRef.id,
        metadata: { [AuditMetadataKeys.KIND]: GenerationKinds.BRIEF },
      });
    } else {
      log.info(
        `generate: brief for ${headSha.slice(0, 8)} already stored — skipping generation`,
      );
      briefRef = { id: existing.id, headIndex: existing.headIndex };
      // Retry-resume: if a prior attempt wrote the brief but died before the
      // narrative, recover the Brief object from the stored body so the
      // narrative isn't permanently lost (marks alone would render the honest
      // "summary unavailable" state forever).
      if (prevBrief !== undefined) {
        const storedNarrative = await store.revisionNarratives.get(
          pullRequestId,
          prevBrief.headSha,
          headSha,
        );
        if (storedNarrative === undefined) {
          const fullRow = await store.briefs.get(
            pullRequestId,
            info.baseSha,
            headSha,
          );
          generatedBrief =
            fullRow === undefined ? undefined : recoverBrief(fullRow.body, log);
        }
      }
    }

    // Once the artifact exists, delete/repost the ready Entry before slower delta work.
    // Check supersession first. On skip reruns, an identical ready body must not re-ping.
    // Only skips need the read: fresh runs still carry a generating body and always refresh.
    await watch.assertCurrent();
    if (entryCommentAllowed) {
      const readyBody = entryCommentBody(deepLink());
      const alreadyLive =
        existing !== undefined && (await entryCommentMatches(readyBody));
      if (alreadyLive) {
        log.info(
          "generate: entry comment already current — skipping repost (no re-ping)",
        );
      } else {
        await refreshEntryComment(readyBody);
      }
    }

    // ---- Marks + revision narrative vs the previous briefed head ------------
    // The prevHead...head span diff is fetched ONCE and reused by the delta
    // loop below, a checkpoint at the previous briefed head (the common
    // reviewed-last-push case) must not re-fetch the same compare diff.
    let prevSpan: PrefetchedSpan | undefined;
    if (prevBrief !== undefined && prevSpanFetch !== undefined) {
      const revDiff = unwrapGitHub(prevSpanFetch);
      prevSpan = {
        baselineSha: prevBrief.headSha,
        diff: revDiff,
        marksWritten: true,
      };
      await writeRevisionArtifacts(payload, {
        revisionNarrative: deps.revisionNarrative,
        hugeSpanRatio: deps.hugeSpanRatio,
        store,
        locator,
        meta,
        revDiff,
        prevBrief,
        briefRef,
        generatedBrief,
        generator,
        watch,
        effort: deps.effort,
        wholePrChangedLines: churn(files),
        loadContext,
        log,
      });
    }

    // ---- Delta cores: one per distinct checkpoint SHA -----------------------
    const deltaCount = await warmDeltaCores(payload, {
      hugeSpanRatio: deps.hugeSpanRatio,
      store,
      repo,
      locator,
      meta,
      source,
      priorBriefs,
      prevSpan,
      generator,
      watch,
      effort: deps.effort,
      briefHeadIndex: briefRef.headIndex,
      wholePrChangedLines: churn(files),
      loadContext,
      log,
    });
    if (deltaCount > 0) {
      await writeAudit(handle, {
        ...auditScope,
        actorType: AuditActorTypes.SYSTEM,
        operation: AUDIT_OPERATION_GENERATE,
        outcome: AuditOutcomes.OK,
        targetType: "pull_request",
        targetId: pullRequestId,
        metadata: {
          [AuditMetadataKeys.KIND]: GenerationKinds.DELTA,
          [AuditMetadataKeys.COUNT]: deltaCount,
        },
      });
    }

    await projection.markSucceeded(target);
    // Sweep projections of heads this one replaced pre-drain: debounce
    // replacement means no worker run ever carried them, so terminal
    // `superseded` applies the same as to a drained abort.
    const swept = await projection.supersedeStaleBriefs(pullRequestId, headSha);
    if (swept > 0) {
      log.info(`generate: swept ${swept} stale queued brief projection(s)`);
    }
    log.info(
      `generate: succeeded for ${prRow.prNumber}@${headSha.slice(0, 8)}`,
    );
  }

  /** The exact-span link both Entry comment bodies point at. */
  function deepLink(): EntryCommentLink {
    return {
      publicBaseUrl: deps.publicBaseUrl,
      repoId: prRow.repoId,
      prNumber: prRow.prNumber,
      baseSha: info.baseSha,
      headSha,
    };
  }

  /**
   * Delete-only sweep for the suppressed state: remove the live Entry comment
   * (404-tolerant) and clear the stored id. Failures never fail the job, the
   * next drain retries naturally.
   */
  async function removeEntryComment(): Promise<void> {
    if (liveEntryCommentId === null) {
      return;
    }
    const deleted = await source.deleteComment(liveEntryCommentId);
    if (!deleted.ok) {
      log.warn(
        `generate: stale entry comment delete failed (job unaffected) — ${deleted.error.message}`,
      );
      return;
    }
    liveEntryCommentId = null;
    const cleared = await repo.pullRequests.setEntryComment(
      pullRequestId,
      null,
    );
    if (!cleared.ok) {
      log.warn(
        `generate: entry comment id not cleared (job unaffected) — ${cleared.error.message}`,
      );
    }
  }

  /**
   * True when the tracked Entry comment exists and its live body already
   * equals `body`. Any uncertainty (no tracked id, comment gone, fetch
   * failure) reports false so the caller falls back to the delete+repost
   * cycle, the self-heals stay intact.
   */
  async function entryCommentMatches(body: string): Promise<boolean> {
    if (liveEntryCommentId === null) {
      return false;
    }
    const fetched = await source.fetchComment(liveEntryCommentId);
    if (!fetched.ok) {
      log.warn(
        `generate: entry comment fetch failed (job unaffected) — ${fetched.error.message}`,
      );
      return false;
    }
    return fetched.value !== undefined && fetched.value.body === body;
  }

  /**
   * Delete/repost rotates the one Entry id and supplies the ready notification ping.
   * The adapter treats already-deleted ids as success. GitHub or storage failures must not
   * fail generation; a later settled head can retry the cycle.
   */
  async function refreshEntryComment(body: string): Promise<void> {
    if (liveEntryCommentId !== null) {
      const deleted = await source.deleteComment(liveEntryCommentId);
      if (!deleted.ok) {
        // Skip the repost: posting past a live comment we failed to delete
        // would leave two. The stored id survives for the next run's retry.
        log.warn(
          `generate: entry comment delete failed (job unaffected) — ${deleted.error.message}`,
        );
        return;
      }
      liveEntryCommentId = null;
    }
    const posted = await source.postEntryComment(body);
    if (!posted.ok) {
      // The old comment is gone and the stored id now dangles; the next
      // refresh's 404-tolerant delete self-heals before reposting.
      log.warn(
        `generate: entry comment post failed (job unaffected) — ${posted.error.message}`,
      );
      return;
    }
    const stored = await repo.pullRequests.setEntryComment(
      pullRequestId,
      posted.value.commentId,
    );
    if (!stored.ok) {
      log.warn(
        `generate: entry comment id not stored (job unaffected) — ${stored.error.message}`,
      );
      // The new comment is untracked: a later run would delete only the OLD
      // stored id and post again, leaving this one behind, two comments.
      // Best-effort delete restores the ONE-comment invariant now.
      const cleanup = await source.deleteComment(posted.value.commentId);
      if (!cleanup.ok) {
        log.warn(
          `generate: untracked entry comment ${posted.value.commentId} not deleted — ${cleanup.error.message}`,
        );
      }
      return;
    }
    liveEntryCommentId = posted.value.commentId;
  }
}

/**
 * Structural guard for a stored brief body. The body was schema-validated at
 * generation time and written by us, so this only defends against the row
 * predating a shape change, checked structurally (never a bare cast).
 */
function isBrief(value: unknown): value is Brief {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate: Record<string, unknown> = { ...value };
  return (
    typeof candidate["summary"] === "string" &&
    Array.isArray(candidate["changeGroups"]) &&
    Array.isArray(candidate["chunks"]) &&
    typeof candidate["pr"] === "object" &&
    candidate["pr"] !== null &&
    typeof candidate["generation"] === "object" &&
    candidate["generation"] !== null
  );
}

/**
 * Every group id the PR's chain has used, read off the previous row. NULL
 * (a row predating the column) heals from the recovered body's groups,
 * never the empty set while a previous brief exists.
 */
function resolveChainGroupIds(
  prevRow: { usedGroupIds: string | null } | undefined,
  previousBody: Brief | undefined,
): readonly string[] {
  if (prevRow !== undefined && prevRow.usedGroupIds !== null) {
    const parsed = StoredIdsSchema.safeParse(prevRow.usedGroupIds);
    if (parsed.success) return parsed.data;
  }
  return previousBody?.changeGroups.map((group) => group.id) ?? [];
}

/** Parse a stored brief body back into a `Brief`, or undefined (logged). */
function recoverBrief(body: string, log: Logger): Brief | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isBrief(parsed)) {
      return parsed;
    }
    log.warn(
      "generate: stored brief body has an unexpected shape — narrative skipped",
    );
    return undefined;
  } catch {
    log.warn(
      "generate: stored brief body is not valid JSON — narrative skipped",
    );
    return undefined;
  }
}

/** Whole-PR churn, the huge-span denominator (metadata, not span diff). */
function churn(
  files: readonly { additions: number; deletions: number }[],
): number {
  return files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
}

function locatorFor(pr: PullRequestRow): PrLocator {
  const split = splitRepoSlug(pr.repoSlug ?? "");
  if (split === undefined) {
    throw new PermanentJobError("pull_request row has no usable repo slug");
  }
  return { owner: split.owner, repo: split.repo, number: pr.prNumber };
}

/**
 * Run a generator call, classifying its throw as transient or permanent, and
 * time it. Nothing downstream records how long a model call took: the
 * generation row's `updated_at` is the last write of any phase, so a finished
 * brief and a timeout are indistinguishable in duration after the fact.
 */
async function runGenerator<T>(
  call: () => Promise<T>,
  log: Logger,
  kind: GenerationKind,
): Promise<T> {
  const startedAt = Date.now();
  const emit = (outcome: GenerationStatus): void => {
    log.info("generator call finished", {
      evt: "generation.complete",
      kind,
      outcome,
      durationMs: Date.now() - startedAt,
    });
  };
  try {
    const value = await call();
    emit(GenerationStatuses.SUCCEEDED);
    return value;
  } catch (error) {
    emit(GenerationStatuses.FAILED);
    if (isTransientGenerationError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    // Preserve the original as `cause`: the provider.error event reads the
    // classification (GeneratorError kind / HTTP status) off it.
    throw new PermanentJobError(
      error instanceof Error ? error.message : String(error),
      {
        cause: error,
      },
    );
  }
}

/** A span diff already fetched this run, reused, never re-fetched. */
interface PrefetchedSpan {
  readonly baselineSha: string;
  readonly diff: string;
  /** Marks for this span were already written this run. */
  readonly marksWritten: boolean;
}

interface RevisionArtifactInputs {
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
  readonly briefRef: { readonly id: BriefRowId; readonly headIndex: number };
  /** Present only when THIS run generated the brief (narrative needs it). */
  readonly generatedBrief: Brief | undefined;
  /** Signal-wrapped generator + the supersession watch gating its calls. */
  readonly generator: Generator;
  readonly watch: SupersessionWatch;
  /** Instance-config reasoning effort; undefined → engine default. */
  readonly effort: Effort | undefined;
  readonly wholePrChangedLines: number;
  /** The ticket context, loaded on first use so a rerun that spends nothing fetches nothing. */
  readonly loadContext: () => Promise<ContextFetch>;
  readonly log: Logger;
}

/**
 * Comparison marks (mechanical, always) + revision narrative (generated,
 * best-effort, a narrative failure never fails the Brief, mirroring
 * `generateAndWrite`). Marks are written BEFORE the narrative call so a
 * failed narrative still leaves highlights available.
 */
async function writeRevisionArtifacts(
  payload: ParsedGeneratePayload,
  inputs: RevisionArtifactInputs,
): Promise<void> {
  const {
    store,
    locator,
    meta,
    revDiff,
    prevBrief,
    briefRef,
    generatedBrief,
    log,
  } = inputs;
  const { pullRequestId, headSha } = payload;
  const prevHeadSha = prevBrief.headSha;

  const marks = buildComparisonMarks(
    headSha,
    prevHeadSha,
    "previous-brief",
    prevBrief.headIndex,
    revDiff,
  );
  // Persistence's strict schema is coordinates-only: pass exactly the SHA
  // pair + files, never the read-time label/index context.
  const marksWritten = await store.comparisonMarks.write({
    pullRequestId,
    marks: {
      baselineSha: marks.baselineSha,
      headSha: marks.headSha,
      files: marks.files,
    },
  });
  if (!marksWritten.ok) {
    // Marks are critical for the comparison UI: surface loudly, but classify
    // as permanent, the same inputs would fail identically on retry.
    throw new PermanentJobError(marksWritten.error.message);
  }

  if (generatedBrief === undefined) {
    // Either the narrative for this span is already stored (retry after a
    // fully-successful revision pass) or the stored brief body couldn't be
    // recovered, marks (above) are idempotently refreshed either way.
    return;
  }

  const skipStub = (
    skipped: RevisionNarrativeSkipped["skipped"],
  ): RevisionNarrativeSkipped => ({
    artifactKind: "revisionNarrativeSkipped",
    pr: generatedBrief.pr,
    prevHeadSha,
    headSha,
    prevIndex: prevBrief.headIndex,
    headIndex: briefRef.headIndex,
    skipped,
  });

  const writeNarrative = async (
    body: string,
    origin: Brief["generation"],
  ): Promise<void> => {
    const written = await store.revisionNarratives.write({
      pullRequestId,
      briefId: briefRef.id,
      prevHeadSha,
      headSha,
      ...getGenerationOrigin(origin),
      body,
    });
    if (!written.ok) {
      throw new PermanentJobError(written.error.message);
    }
  };

  const narrativeGate = inputs.revisionNarrative ?? { enabled: true };
  if (!narrativeGate.enabled) {
    await writeNarrative(
      JSON.stringify(skipStub("disabled by config")),
      generatedBrief.generation,
    );
    return;
  }
  const revSpanHuge = isHugeSpan(
    countChangedLines(revDiff),
    inputs.wholePrChangedLines,
    inputs.hugeSpanRatio,
  );
  if (revSpanHuge) {
    await writeNarrative(
      JSON.stringify(skipStub("span too large")),
      generatedBrief.generation,
    );
    log.info("generate: revision span too large; wrote skip stub");
    return;
  }

  // Supersession gate BEFORE spending on the narrative call; deliberately
  // outside the try, a supersession must propagate, never be swallowed as a
  // narrative failure.
  await inputs.watch.assertCurrent();
  const { links, primaryTicket } = await inputs.loadContext();
  try {
    const narrative = await categorizeRevisionNarrative(
      {
        locator,
        meta,
        prevHeadSha,
        headSha,
        prevIndex: prevBrief.headIndex,
        headIndex: briefRef.headIndex,
        incrementalDiff: revDiff,
        links,
        primaryTicket,
        brief: generatedBrief,
        marksFiles: marks.files,
      },
      inputs.generator,
      (message) => log.info(message),
      inputs.effort,
    );
    await writeNarrative(JSON.stringify(narrative), narrative.generation);
  } catch (error) {
    if (inputs.watch.signal.aborted) {
      // A mid-stream abort is a supersession, not a narrative failure.
      throw error;
    }
    log.warn(
      `generate: revision narrative failed (Brief unaffected): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * The checkpoint span diff, or undefined when GitHub can no longer render it:
 * a single unrenderable/GC'd span must not sink the whole job (the brief is
 * already stored); the view falls back to the full Brief.
 */
async function resolveDeltaSpanDiff(
  source: PullRequestSource,
  baselineSha: string,
  headSha: string,
  log: Logger,
): Promise<string | undefined> {
  const spanDiff = await source.fetchCompareDiff(baselineSha, headSha);
  if (spanDiff.ok) {
    return spanDiff.value;
  }

  if (isPermanentGitHubError(spanDiff.error)) {
    log.warn(
      `generate: delta span ${baselineSha.slice(0, 8)} unavailable — skipping`,
    );
    return undefined;
  }
  throw new Error(spanDiff.error.message);
}

interface DeltaWarmInputs {
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
  /** The ticket context, loaded on first use so a rerun that spends nothing fetches nothing. */
  readonly loadContext: () => Promise<ContextFetch>;
  readonly log: Logger;
}

/**
 * Prewarm each distinct checkpoint: skip stored cores, write mechanical marks, then apply
 * the huge-span guard before model spend. Missing huge-span deltas signal full-brief fallback.
 * A failed span aborts with its classification; stored earlier spans survive for retry.
 */
async function warmDeltaCores(
  payload: ParsedGeneratePayload,
  inputs: DeltaWarmInputs,
): Promise<number> {
  const { store, repo, locator, meta, source, priorBriefs, log } = inputs;
  const { pullRequestId, headSha } = payload;

  const checkpoints = await repo.checkpoints.listForPullRequest(pullRequestId);
  const distinctShas = [
    ...new Set(checkpoints.map((c) => c.lastSubmittedSha)),
  ].filter((sha) => sha !== headSha);

  let generated = 0;
  for (const baselineSha of distinctShas) {
    // oxlint-disable-next-line no-await-in-loop -- spans run sequentially by design (one model call at a time)
    const already = await store.deltas.get(pullRequestId, baselineSha, headSha);
    if (already !== undefined) {
      continue;
    }
    // Reuse the prevHead...head diff fetched for the revision artifacts when
    // the checkpoint sits at the previous briefed head (the common
    // reviewed-last-push case), never fetch the same span twice in one run.
    const prefetched =
      inputs.prevSpan?.baselineSha === baselineSha
        ? inputs.prevSpan
        : undefined;
    let incrementalDiff: string;
    if (prefetched !== undefined) {
      incrementalDiff = prefetched.diff;
    } else {
      // oxlint-disable-next-line no-await-in-loop
      const spanDiff = await resolveDeltaSpanDiff(
        source,
        baselineSha,
        headSha,
        log,
      );
      if (spanDiff === undefined) {
        continue;
      }
      incrementalDiff = spanDiff;
    }

    const baselineIndex =
      priorBriefs.find((row) => row.headSha === baselineSha)?.headIndex ?? null;
    if (prefetched?.marksWritten !== true) {
      // Span marks BEFORE the LLM call: a failed delta still leaves
      // highlights for the checkpoint span.
      const marks = buildComparisonMarks(
        headSha,
        baselineSha,
        "checkpoint",
        baselineIndex,
        incrementalDiff,
      );
      // oxlint-disable-next-line no-await-in-loop
      const marksWritten = await store.comparisonMarks.write({
        pullRequestId,
        marks: {
          baselineSha: marks.baselineSha,
          headSha: marks.headSha,
          files: marks.files,
        },
      });
      if (!marksWritten.ok) {
        throw new PermanentJobError(marksWritten.error.message);
      }
    }

    const deltaSpanHuge = isHugeSpan(
      countChangedLines(incrementalDiff),
      inputs.wholePrChangedLines,
      inputs.hugeSpanRatio,
    );
    if (deltaSpanHuge) {
      log.info(
        `generate: delta span ${baselineSha.slice(0, 8)} is huge — full-brief fallback`,
      );
      continue;
    }

    // oxlint-disable-next-line no-await-in-loop -- one shared load, memoized
    const { links, primaryTicket } = await inputs.loadContext();
    const deltaInput: DeltaInput = {
      locator,
      meta,
      baselineSha,
      headSha,
      baselineIndex,
      headIndex: inputs.briefHeadIndex,
      incrementalDiff,
      links,
      primaryTicket,
    };
    // Supersession gate BEFORE each delta spend.
    // oxlint-disable-next-line no-await-in-loop
    await inputs.watch.assertCurrent();
    // oxlint-disable-next-line no-await-in-loop
    const delta = await runGenerator(
      () =>
        categorizeDelta(
          deltaInput,
          inputs.generator,
          (message) => log.info(message),
          inputs.effort,
        ),
      log,
      GenerationKinds.DELTA,
    );
    // oxlint-disable-next-line no-await-in-loop
    const written = await store.deltas.write({
      pullRequestId,
      baselineSha,
      headSha,
      ...getGenerationOrigin(delta.generation),
      body: JSON.stringify(delta),
    });
    if (!written.ok) {
      throw new PermanentJobError(written.error.message);
    }
    generated += 1;
  }
  return generated;
}
