// The `generate` task (BRIEF-3 Part 2) — the drain side of the pipeline the
// webhook enqueues into. One job = "bring this PR's artifacts up to date at
// this head": the shared Brief (plus, when a previous briefed head exists,
// the mechanical comparison marks and the revision narrative), then the
// pre-warmed delta cores — one per DISTINCT checkpoint SHA on the PR (ADR
// 0006 #4 as amended 2026-07-05), each guarded by the huge-span skip (#7).
// The generation engine (`categorizer`) is reused as-is behind its
// `Generator` port; this module owns ONLY orchestration: payload validation,
// tenancy, idempotent skip/reuse, projection transitions, and error mapping.
//
// STATE MODEL (`generation` projection, kind `brief` — the row `ingest.ts`
// queued): queued → running(phase) → succeeded | failed | superseded.
//   - superseded (terminal, NOT a failure): the PR head advanced past the
//     job's head, or the PR reached a terminal state — no retry, `attempts`
//     untouched (ADR 0006 #6). Part 3 extends this to mid-call aborts.
//   - failed: recorded via `markFailed` (which sanitizes). PERMANENT
//     failures (404/406/unrenderable inputs, deterministic generation
//     failures) return normally so graphile does NOT retry a job that cannot
//     succeed; TRANSIENT failures (rate limits, 5xx, network) rethrow so
//     graphile's backoff/dead-letter machinery owns the retry.
//
// IDEMPOTENCY (retries must not double-spend tokens): the brief is skipped
// when its (base, head) row already exists; each delta core is skipped when
// its (checkpoint, head) row exists; marks/narrative writes are
// content-addressed upserts. A retry therefore only pays for what a prior
// attempt didn't finish.
import {
  categorize,
  categorizeDelta,
  categorizeRevisionNarrative,
  buildComparisonMarks,
  countChangedLines,
  fetchLinkedContext,
  isHugeSpan,
  revisionNarrativeConfig,
  type Brief,
  type DeltaInput,
  type Generator,
  type LinkedContext,
  type PrLocator,
  type PrMetadata,
  type RevisionNarrativeSkipped,
} from "categorizer";
import {
  artifactStore,
  audit,
  AuditAction,
  AuditActorType,
  AuditMetadataKey,
  forTenant,
  generationProjection,
  GenerationKind,
  GenerationPhase,
  PrState,
  type AppDatabase,
  type ArtifactStore,
  type BriefRowId,
  type BriefSpanRow,
  type GenerationTarget,
  type PullRequestRow,
  type TenantRepository,
} from "persistence";
import { GitHubApiErrorCode } from "github";
import type { Result } from "types";
import {
  splitRepoSlug,
  type GitHubApiError,
  type GitHubPort,
  type PullRequestSource,
} from "./github-port";
import { parseGeneratePayload, type ParsedGeneratePayload } from "./payload";

export type Logger = (message: string) => void;

export interface GenerateTaskDeps {
  readonly handle: AppDatabase;
  readonly generator: Generator;
  readonly github: GitHubPort;
  readonly log?: Logger;
}

/**
 * A failure that retrying cannot fix (missing PR, unrenderable diff,
 * deterministic generation failure). Marked `failed` on the projection but
 * NOT rethrown to graphile — a retry would only burn spend.
 */
class PermanentJobError extends Error {}

/** 406 = GitHub refuses to render the diff (too large) — permanent per span. */
function isPermanentGitHubError(error: GitHubApiError): boolean {
  return (
    error.code === GitHubApiErrorCode.NOT_FOUND ||
    error.code === GitHubApiErrorCode.UNAUTHORIZED ||
    error.code === GitHubApiErrorCode.FORBIDDEN ||
    error.status === 406
  );
}

/** Unwrap a GitHub `Result`, converting failures into the right error class. */
function unwrapGitHub<T>(result: Result<T, GitHubApiError>): T {
  if (result.ok) {
    return result.value;
  }
  if (isPermanentGitHubError(result.error)) {
    throw new PermanentJobError(result.error.message);
  }
  // Transient (rate limit / 5xx / network): plain Error → graphile retries.
  throw new Error(result.error.message);
}

/**
 * Classify a thrown generation error. The Anthropic SDK's transient failures
 * (429/5xx/408, connection drops) carry a numeric `status` or an
 * APIConnectionError name; anything else (refusal, schema failure after the
 * built-in feedback retry) is deterministic enough that a graphile retry
 * would re-spend tokens for the same outcome.
 */
function isTransientGenerationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const status = Reflect.get(error, "status");
  if (typeof status === "number") {
    return status === 408 || status === 429 || status >= 500;
  }
  return error instanceof Error && error.name.includes("APIConnectionError");
}

/**
 * Artifact provenance from the engine's `Generation` metadata. `effort` is
 * null for adapters without an effort knob (ADR 0013); the store column is a
 * plain string, so null normalizes to the honest "none".
 */
function provenanceOf(generation: Brief["generation"]): {
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

/** The brief-kind projection target the ingest transaction queued. */
function briefTarget(payload: ParsedGeneratePayload): GenerationTarget {
  return {
    pullRequestId: payload.pullRequestId,
    kind: GenerationKind.BRIEF,
    headSha: payload.headSha,
    baselineSha: null,
  };
}

/**
 * Build the generate task. The returned function is graphile's `Task` shape
 * (it ignores helpers); tests call it directly with a payload.
 */
export function createGenerateTask(deps: GenerateTaskDeps): (payload: unknown) => Promise<void> {
  const log = deps.log ?? (() => {});

  return async function generate(rawPayload: unknown): Promise<void> {
    const parsed = parseGeneratePayload(rawPayload);
    if (!parsed.ok) {
      // Poisoned/foreign job: no projection row is addressable — drop it.
      log(`generate: dropping malformed payload — ${parsed.error}`);
      return;
    }
    const payload = parsed.value;
    const projection = generationProjection(deps.handle, payload.ctx);
    const target = briefTarget(payload);

    try {
      await runGeneration(deps, payload, target, log);
    } catch (error) {
      if (error instanceof SupersededSignal) {
        // Not a failure: terminal `superseded`, attempts untouched, no retry.
        await projection.markSuperseded(target);
        log(`generate: superseded (${error.message})`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await projection.markFailed(target, message);
      if (error instanceof PermanentJobError) {
        // markFailed already recorded it; a graphile retry cannot help.
        log(`generate: permanent failure — ${message}`);
        return;
      }
      log(`generate: failed (${message}) — handing to graphile for retry`);
      throw error;
    }
  };
}

/** Control-flow signal: the job's head is no longer the PR's head. */
class SupersededSignal extends Error {}

async function runGeneration(
  deps: GenerateTaskDeps,
  payload: ParsedGeneratePayload,
  target: GenerationTarget,
  log: Logger,
): Promise<void> {
  const { handle, generator, github } = deps;
  const { ctx, pullRequestId, headSha } = payload;
  const repo = forTenant(handle, ctx);
  const projection = generationProjection(handle, ctx);
  const store = artifactStore(handle, ctx);

  const pr = await repo.pullRequests.getById(pullRequestId);
  if (pr === undefined) {
    // Row purged/never existed: nothing addressable, nothing to mark.
    log(`generate: pull_request ${pullRequestId} not in tenant — dropping job`);
    return;
  }
  if (pr.state === PrState.CLOSED || pr.state === PrState.MERGED) {
    // A brief for a terminal PR would never be read (same rule as the
    // enqueue gate); the queued projection row must not sit forever.
    throw new SupersededSignal(`pull_request ${pr.prNumber} is ${pr.state}`);
  }
  if (pr.repoSlug == null || splitRepoSlug(pr.repoSlug) === undefined) {
    throw new PermanentJobError("pull_request row has no usable repo slug");
  }

  await projection.markRunning(target, GenerationPhase.FETCHING);

  const source = await github.forPullRequest(ctx.installationId, pr.repoSlug, pr.prNumber);
  const info = unwrapGitHub(await source.fetchPullRequest());
  if (info.headSha !== headSha) {
    // The PR moved between enqueue and drain — the newer push's job (same
    // job_key, replaced) will generate the new head; this one is obsolete.
    throw new SupersededSignal(`head advanced ${headSha.slice(0, 8)} → ${info.headSha.slice(0, 8)}`);
  }
  if (info.state !== "open") {
    throw new SupersededSignal(`pull_request ${pr.prNumber} is ${info.state} on GitHub`);
  }

  const files = unwrapGitHub(await source.fetchPullRequestFiles());
  const diff = unwrapGitHub(await source.fetchDiff());

  const locator: PrLocator = locatorFor(pr);
  const meta: PrMetadata = {
    title: info.title,
    body: info.body,
    url: info.htmlUrl,
    sha: info.headSha,
    baseSha: info.baseSha,
    commitCount: info.commitCount,
    files,
  };
  const links = await fetchLinkedContext(meta.body, log);

  // ---- The shared Brief (skip-if-exists: retries never re-spend) ----------
  const priorBriefs = await store.briefs.listForPullRequest(pullRequestId);
  const existing = priorBriefs.find(
    (row) => row.baseSha === info.baseSha && row.headSha === headSha,
  );
  // Previous briefed head = highest-index brief whose head differs (the
  // DB-mode equivalent of the CLI manifest lookup).
  const prevBrief = priorBriefs.toReversed().find((row) => row.headSha !== headSha);

  let briefRef: { id: BriefRowId; headIndex: number };
  let generatedBrief: Brief | undefined;
  if (existing === undefined) {
    const headIndex = (priorBriefs.at(-1)?.headIndex ?? 0) + 1;
    await projection.markRunning(target, GenerationPhase.GENERATING);
    const brief = await runGenerator(() =>
      categorize(
        { locator, meta, diff, links },
        headIndex,
        { base: info.baseSha, head: headSha, commitCount: info.commitCount },
        generator,
        log,
      ),
    );
    await projection.markRunning(target, GenerationPhase.WRITING);
    const written = await store.briefs.write({
      pullRequestId,
      baseSha: info.baseSha,
      headSha,
      headIndex,
      commitCount: info.commitCount,
      ...provenanceOf(brief.generation),
      body: JSON.stringify(brief),
    });
    if (!written.ok) {
      throw new PermanentJobError(written.error.message);
    }
    briefRef = { id: written.value.id, headIndex: written.value.headIndex };
    generatedBrief = brief;
    await audit(handle, {
      installationId: ctx.installationId,
      actorType: AuditActorType.SYSTEM,
      action: AuditAction.GENERATE,
      targetType: "brief",
      targetId: briefRef.id,
      metadata: { [AuditMetadataKey.KIND]: GenerationKind.BRIEF },
    });
  } else {
    log(`generate: brief for ${headSha.slice(0, 8)} already stored — skipping generation`);
    briefRef = { id: existing.id, headIndex: existing.headIndex };
  }

  // ---- Marks + revision narrative vs the previous briefed head ------------
  // The prevHead...head span diff is fetched ONCE and reused by the delta
  // loop below — a checkpoint at the previous briefed head (the common
  // reviewed-last-push case) must not re-fetch the same compare diff.
  let prevSpan: PrefetchedSpan | undefined;
  if (prevBrief !== undefined) {
    const revDiff = unwrapGitHub(await source.fetchCompareDiff(prevBrief.headSha, headSha));
    prevSpan = { baselineSha: prevBrief.headSha, diff: revDiff, marksWritten: true };
    await writeRevisionArtifacts(deps, payload, {
      store,
      locator,
      meta,
      revDiff,
      prevBrief,
      briefRef,
      generatedBrief,
      wholePrChangedLines: churn(files),
      links,
      log,
    });
  }

  // ---- Delta cores: one per distinct checkpoint SHA (ADR 0006 #4) ---------
  const deltaCount = await warmDeltaCores(deps, payload, {
    store,
    repo,
    locator,
    meta,
    source,
    priorBriefs,
    prevSpan,
    briefHeadIndex: briefRef.headIndex,
    wholePrChangedLines: churn(files),
    links,
    log,
  });
  if (deltaCount > 0) {
    await audit(handle, {
      installationId: ctx.installationId,
      actorType: AuditActorType.SYSTEM,
      action: AuditAction.GENERATE,
      targetType: "pull_request",
      targetId: pullRequestId,
      metadata: {
        [AuditMetadataKey.KIND]: GenerationKind.DELTA,
        [AuditMetadataKey.COUNT]: deltaCount,
      },
    });
  }

  await projection.markSucceeded(target);
  log(`generate: succeeded for ${pr.prNumber}@${headSha.slice(0, 8)}`);
}

/** Whole-PR churn — the huge-span denominator (metadata, not span diff). */
function churn(files: readonly { additions: number; deletions: number }[]): number {
  return files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
}

function locatorFor(pr: PullRequestRow): PrLocator {
  const split = splitRepoSlug(pr.repoSlug ?? "");
  if (split === undefined) {
    throw new PermanentJobError("pull_request row has no usable repo slug");
  }
  return { owner: split.owner, repo: split.repo, number: pr.prNumber };
}

/** Run a generator call, classifying its throw as transient or permanent. */
async function runGenerator<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isTransientGenerationError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    throw new PermanentJobError(error instanceof Error ? error.message : String(error));
  }
}

/** A span diff already fetched this run — reused, never re-fetched. */
interface PrefetchedSpan {
  readonly baselineSha: string;
  readonly diff: string;
  /** Marks for this span were already written this run. */
  readonly marksWritten: boolean;
}

interface RevisionArtifactInputs {
  readonly store: ArtifactStore;
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  /** The prevHead...head compare diff, fetched once by the caller. */
  readonly revDiff: string;
  readonly prevBrief: BriefSpanRow;
  readonly briefRef: { readonly id: BriefRowId; readonly headIndex: number };
  /** Present only when THIS run generated the brief (narrative needs it). */
  readonly generatedBrief: Brief | undefined;
  readonly wholePrChangedLines: number;
  readonly links: LinkedContext[];
  readonly log: Logger;
}

/**
 * Comparison marks (mechanical, always) + revision narrative (generated,
 * best-effort — a narrative failure never fails the Brief, mirroring
 * `generateAndWrite`). Marks are written BEFORE the narrative call so a
 * failed narrative still leaves highlights available (ADR 0021/0024).
 */
async function writeRevisionArtifacts(
  deps: GenerateTaskDeps,
  payload: ParsedGeneratePayload,
  inputs: RevisionArtifactInputs,
): Promise<void> {
  const { store, locator, meta, revDiff, prevBrief, briefRef, generatedBrief, links, log } = inputs;
  const { pullRequestId, headSha } = payload;
  const prevHeadSha = prevBrief.headSha;

  const marks = buildComparisonMarks(headSha, prevHeadSha, "previous-brief", prevBrief.headIndex, revDiff);
  // Persistence's strict schema is coordinates-only (D13): pass exactly the
  // SHA pair + files, never the CLI's read-time label/index context.
  const marksWritten = await store.comparisonMarks.write({
    pullRequestId,
    marks: { baselineSha: marks.baselineSha, headSha: marks.headSha, files: marks.files },
  });
  if (!marksWritten.ok) {
    // Marks are load-bearing for the comparison UI: surface loudly (the CLI
    // never catches marks failures either), but classify as permanent — the
    // same inputs would fail identically on retry.
    throw new PermanentJobError(marksWritten.error.message);
  }

  if (generatedBrief === undefined) {
    // Brief was reused from a prior attempt; without the parsed Brief object
    // the narrative's alignment context is unavailable. Marks (above) are
    // idempotently refreshed; an already-written narrative row is kept.
    return;
  }

  const skipStub = (skipped: RevisionNarrativeSkipped["skipped"]): RevisionNarrativeSkipped => ({
    artifactKind: "revisionNarrativeSkipped",
    pr: generatedBrief.pr,
    prevHeadSha,
    headSha,
    prevIndex: prevBrief.headIndex,
    headIndex: briefRef.headIndex,
    skipped,
  });

  const writeNarrative = async (body: string, provenance: Brief["generation"]): Promise<void> => {
    const written = await store.revisionNarratives.write({
      pullRequestId,
      briefId: briefRef.id,
      prevHeadSha,
      headSha,
      ...provenanceOf(provenance),
      body,
    });
    if (!written.ok) {
      throw new PermanentJobError(written.error.message);
    }
  };

  if (!revisionNarrativeConfig().enabled) {
    await writeNarrative(JSON.stringify(skipStub("disabled by config")), generatedBrief.generation);
    return;
  }
  if (isHugeSpan(countChangedLines(revDiff), inputs.wholePrChangedLines)) {
    await writeNarrative(JSON.stringify(skipStub("span too large")), generatedBrief.generation);
    log("generate: revision span too large; wrote skip stub");
    return;
  }

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
        brief: generatedBrief,
      },
      deps.generator,
      log,
    );
    await writeNarrative(JSON.stringify(narrative), narrative.generation);
  } catch (error) {
    log(
      `generate: revision narrative failed (Brief unaffected): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

interface DeltaWarmInputs {
  readonly store: ArtifactStore;
  readonly repo: TenantRepository;
  readonly locator: PrLocator;
  readonly meta: PrMetadata;
  readonly source: PullRequestSource;
  readonly priorBriefs: readonly BriefSpanRow[];
  /** The prevHead...head span already fetched (and marks written) this run. */
  readonly prevSpan: PrefetchedSpan | undefined;
  readonly briefHeadIndex: number;
  readonly wholePrChangedLines: number;
  readonly links: LinkedContext[];
  readonly log: Logger;
}

/**
 * Pre-warm one delta core per DISTINCT checkpoint SHA on the PR (ADR 0006 #4
 * as amended: every settled push-bundle, never lazy). Per checkpoint:
 * skip-if-stored → span marks (mechanical, before the LLM call) → huge-span
 * skip (the view falls back to the full Brief; absence IS the signal) →
 * generate + write. A failed span aborts the job with its classification;
 * completed spans are stored, so a retry resumes where it stopped.
 */
async function warmDeltaCores(
  deps: GenerateTaskDeps,
  payload: ParsedGeneratePayload,
  inputs: DeltaWarmInputs,
): Promise<number> {
  const { store, repo, locator, meta, source, priorBriefs, log } = inputs;
  const { pullRequestId, headSha } = payload;

  const checkpoints = await repo.checkpoints.listForPullRequest(pullRequestId);
  const distinctShas = [...new Set(checkpoints.map((c) => c.lastSubmittedSha))].filter(
    (sha) => sha !== headSha,
  );

  let generated = 0;
  for (const baselineSha of distinctShas) {
    // eslint-disable-next-line no-await-in-loop -- spans run sequentially by design (one model call at a time, ADR 0015)
    const already = await store.deltas.get(pullRequestId, baselineSha, headSha);
    if (already !== undefined) {
      continue;
    }
    // Reuse the prevHead...head diff fetched for the revision artifacts when
    // the checkpoint sits at the previous briefed head (the common
    // reviewed-last-push case) — never fetch the same span twice in one run.
    const prefetched = inputs.prevSpan?.baselineSha === baselineSha ? inputs.prevSpan : undefined;
    let incrementalDiff: string;
    if (prefetched !== undefined) {
      incrementalDiff = prefetched.diff;
    } else {
      // eslint-disable-next-line no-await-in-loop
      const spanDiff = await source.fetchCompareDiff(baselineSha, headSha);
      if (!spanDiff.ok) {
        if (isPermanentGitHubError(spanDiff.error)) {
          // A single unrenderable/GC'd span must not sink the whole job (the
          // brief is already stored); the view falls back to the full Brief.
          log(`generate: delta span ${baselineSha.slice(0, 8)} unavailable — skipping`);
          continue;
        }
        throw new Error(spanDiff.error.message);
      }
      incrementalDiff = spanDiff.value;
    }

    const baselineIndex =
      priorBriefs.find((row) => row.headSha === baselineSha)?.headIndex ?? null;
    if (prefetched?.marksWritten !== true) {
      // Span marks BEFORE the LLM call (delta-CLI ordering): a failed delta
      // still leaves highlights for the checkpoint span.
      const marks = buildComparisonMarks(headSha, baselineSha, "checkpoint", baselineIndex, incrementalDiff);
      // eslint-disable-next-line no-await-in-loop
      const marksWritten = await store.comparisonMarks.write({
        pullRequestId,
        marks: { baselineSha: marks.baselineSha, headSha: marks.headSha, files: marks.files },
      });
      if (!marksWritten.ok) {
        throw new PermanentJobError(marksWritten.error.message);
      }
    }

    if (isHugeSpan(countChangedLines(incrementalDiff), inputs.wholePrChangedLines)) {
      log(`generate: delta span ${baselineSha.slice(0, 8)} is huge — full-brief fallback`);
      continue;
    }

    const deltaInput: DeltaInput = {
      locator,
      meta,
      baselineSha,
      headSha,
      baselineIndex,
      headIndex: inputs.briefHeadIndex,
      incrementalDiff,
      links: inputs.links,
    };
    // eslint-disable-next-line no-await-in-loop
    const delta = await runGenerator(() => categorizeDelta(deltaInput, deps.generator, log));
    // eslint-disable-next-line no-await-in-loop
    const written = await store.deltas.write({
      pullRequestId,
      baselineSha,
      headSha,
      ...provenanceOf(delta.generation),
      body: JSON.stringify(delta),
    });
    if (!written.ok) {
      throw new PermanentJobError(written.error.message);
    }
    generated += 1;
  }
  return generated;
}
