import { createHash } from "node:crypto";
import type { MultiCallHooks, PartKey } from "brief-core";
import {
  GenerationPartKinds,
  InvalidArtifactBodyError,
  type GenerationPartBody,
  type GenerationPartRow,
  type GenerationSpan,
} from "persistence";
import { GenerationFailureCodes } from "types/generations";
import { PermanentJobError, TransientJobError } from "../../failure";
import {
  GitAttributesReadings,
  type GitAttributesRead,
  type MultiCallRunInputs,
  type RunContext,
} from "../types";
import { isClassifiedThrow, isPermanentFailure } from "./errors";
import { postLargeGeneratingEntry } from "./generating-entry";
import { claimRunUnits } from "./spend-gate";
import { throwOnClaimLost } from "./supersession-watch";

const GROUPING_KEY: PartKey = "grouping";
const DETAIL_KEY_PREFIX = "detail:";
const FIRST_HALF = "1";

type StoredParts = ReadonlyMap<PartKey, GenerationPartBody>;

/** The brief span this run's parts belong to. */
export function getBriefSpan(context: RunContext): GenerationSpan {
  const { payload, prInfo } = context;
  return {
    pullRequestId: payload.pullRequestId,
    baseSha: prInfo.baseSha,
    headSha: payload.headSha,
  };
}

/** The span's parts are dead once its brief is stored; the writer deletes them, and so does a run that found the brief stored. */
export async function deleteSpanParts(context: RunContext): Promise<void> {
  const deleted = await context.parts.deleteForSpan(getBriefSpan(context));
  if (deleted > 0) {
    context.log.info(`generate: deleted ${deleted} stored part(s) of the span`);
  }
}

/**
 * The post-write delete: the brief is stored, so a failed delete only warns,
 * and the next run over the pair's stored brief sweeps what it left.
 */
export async function sweepSpanParts(context: RunContext): Promise<void> {
  try {
    await deleteSpanParts(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.log.warn("generate: the stored parts could not be deleted", {
      error: message,
    });
  }
}

/** An absent file and an empty one shorten nothing alike, so they digest alike. */
export function digestGitAttributes(text: string | undefined): string {
  return createHash("sha256")
    .update(text ?? "")
    .digest("hex");
}

/**
 * Why a span's stored parts cannot seed this run: detail parts are reusable
 * only under the grouping that planned their batches, and a grouping is
 * reusable only over the `.gitattributes` that shaped its outline.
 */
function readStaleReason(
  parts: StoredParts,
  gitAttributesDigest: string,
): string | undefined {
  const grouping = parts.get(GROUPING_KEY);
  if (grouping === undefined) {
    return "without a grouping part";
  }
  const sameAttributes =
    grouping.kind === GenerationPartKinds.GROUPING &&
    grouping.gitAttributesDigest === gitAttributesDigest;
  return sameAttributes ? undefined : "under another .gitattributes";
}

/** A body the store no longer accepts fails every resume the same way, so the span starts over. */
async function readSpanParts(
  context: RunContext,
): Promise<GenerationPartRow[] | undefined> {
  try {
    return await context.parts.listForSpan(getBriefSpan(context));
  } catch (error) {
    if (error instanceof InvalidArtifactBodyError) {
      return undefined;
    }
    throw error;
  }
}

/** A span holding no part needs no digest, so an unread `.gitattributes` fails only a span with parts. */
async function listResumableParts(
  context: RunContext,
  requireGitAttributesDigest: () => string,
): Promise<StoredParts> {
  const { log } = context;
  const rows = await readSpanParts(context);
  const byKey = new Map(rows?.map((row) => [row.partKey, row.body]));
  if (rows !== undefined && byKey.size === 0) {
    return byKey;
  }
  const gitAttributesDigest = requireGitAttributesDigest();
  const stale =
    rows === undefined
      ? "off their stored shape"
      : readStaleReason(byKey, gitAttributesDigest);
  if (stale === undefined) {
    return byKey;
  }

  log.warn(`generate: stored part(s) ${stale}, starting the run over`);
  await deleteSpanParts(context);
  return new Map();
}

function readDetailBody(body: unknown): { readonly chunks: unknown } {
  const hasChunks =
    typeof body === "object" && body !== null && "chunks" in body;
  if (!hasChunks) {
    throw new Error("generate: a detail part's body carries no chunks");
  }
  return { chunks: body.chunks };
}

/** The stored shape of a part the engine handed over. */
function wrapPartBody(
  key: PartKey,
  body: unknown,
  requireDigest: () => string,
): unknown {
  if (key === GROUPING_KEY) {
    return {
      kind: GenerationPartKinds.GROUPING,
      grouping: body,
      gitAttributesDigest: requireDigest(),
    };
  }
  return { kind: GenerationPartKinds.DETAIL, ...readDetailBody(body) };
}

/** The engine's shape of a stored part: the grouping output, or `{ chunks }`. */
function unwrapPartBody(body: GenerationPartBody): unknown {
  if (body.kind === GenerationPartKinds.GROUPING) {
    return body.grouping;
  }
  return { chunks: body.chunks };
}

/**
 * The detail call a fresh part completes: a whole batch, or the second half
 * of a cut one, whose first half landed before it in the same lane.
 */
export function readCompletedDetailCall(key: PartKey): number | undefined {
  if (!key.startsWith(DETAIL_KEY_PREFIX)) {
    return undefined;
  }
  const [index, half] = key.slice(DETAIL_KEY_PREFIX.length).split(":");
  if (half === FIRST_HALF) {
    return undefined;
  }
  return Number(index);
}

/**
 * A hook's throw crosses the engine and `runGenerator`, which reads any
 * unclassified throw as a permanent generation failure. The store's throws
 * are infra: transient, so graphile retries and the parts already paid for
 * stay stored. A `RangeError` is a caller's bug, as the engine's own lane
 * count check throws: permanent, never retried. A run signal or a
 * classified throw passes as it is.
 */
async function runHookStep<Value>(step: () => Promise<Value>): Promise<Value> {
  try {
    return await step();
  } catch (error) {
    if (isClassifiedThrow(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof RangeError) {
      throw new PermanentJobError(message, { cause: error });
    }
    throw new TransientJobError(message, { cause: error });
  }
}

/**
 * A reader of the digest a span's parts are stored and compared under. A
 * file a retry may still read has no digest: a span holding parts ends the
 * run transient before any paid call, so the parts stay for the retry and no
 * part is ever stored or wiped under a digest of a file the run never saw.
 */
function makeGitAttributesDigestReader(read: GitAttributesRead): () => string {
  if (read.kind === GitAttributesReadings.UNREAD) {
    return () => {
      throw new TransientJobError(
        `generate: .gitattributes unread (${read.error}), the span's parts cannot be told apart`,
        { failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE } },
      );
    };
  }
  const digest = digestGitAttributes(
    read.kind === GitAttributesReadings.CONTENT ? read.text : undefined,
  );
  return () => digest;
}

/**
 * The worker's side of a multi-call run: stored parts answer `loadPart`, each
 * fresh part is stored and counted on the attempt row as it lands, the
 * detail calls not yet stored are claimed as units once the grouping call
 * planned them, and the first detail call pins the supersession watch. The
 * span's parts are read once, on the first hook call.
 */
export function createMultiCallRun(
  context: RunContext,
  runId: string,
  gitAttributesRead: GitAttributesRead,
): MultiCallRunInputs {
  const { deps, parts, projection, log } = context;
  const span = getBriefSpan(context);
  const gitAttributes =
    gitAttributesRead.kind === GitAttributesReadings.CONTENT
      ? gitAttributesRead.text
      : undefined;
  const requireGitAttributesDigest =
    makeGitAttributesDigestReader(gitAttributesRead);
  let stored: Promise<StoredParts> | undefined;
  let missingDetailCalls: readonly number[] | undefined;
  const completedDetailCalls = new Set<number>();

  function readStored(): Promise<StoredParts> {
    stored ??= listResumableParts(context, requireGitAttributesDigest);
    return stored;
  }
  /**
   * A grouping that ran fresh plans its own batches: every detail part the
   * span holds, whole or half, is dead before the first detail call can
   * store a new one, and the units count every call again.
   */
  async function discardPartsUnderFreshGrouping(): Promise<void> {
    const current = await readStored();
    if (current.size > 0) {
      log.warn(
        `generate: the grouping ran fresh, ${current.size} stored part(s) discarded`,
      );
      await deleteSpanParts(context);
    }
    stored = Promise.resolve(new Map());
  }
  function hasEveryDetailPart(): boolean {
    return (
      missingDetailCalls?.every((call) => completedDetailCalls.has(call)) ??
      false
    );
  }

  const hooks: MultiCallHooks = {
    loadPart: (key) =>
      runHookStep(async () => {
        const current = await readStored();
        // Even over an empty span: a multi-call run must end before its paid grouping call.
        requireGitAttributesDigest();
        const body = current.get(key);
        return body === undefined ? undefined : unwrapPartBody(body);
      }),
    onPartDone: (key, body) =>
      runHookStep(async () => {
        if (key === GROUPING_KEY) {
          await discardPartsUnderFreshGrouping();
        }
        await parts.write({
          ...span,
          partKey: key,
          body: wrapPartBody(key, body, requireGitAttributesDigest),
        });
        const completed = readCompletedDetailCall(key);
        if (completed === undefined) {
          return;
        }
        completedDetailCalls.add(completed);
        throwOnClaimLost(await projection.recordPartDone(runId));
      }),
    onGroupingDone: (plan) =>
      runHookStep(async () => {
        missingDetailCalls = plan.missingDetailCalls;
        const missing = plan.missingDetailCalls.length;
        if (missing > 0) {
          await claimRunUnits(context, missing);
        }
        throwOnClaimLost(
          await projection.recordPartsPlanned(runId, {
            total: plan.detailCalls,
            done: plan.detailCalls - missing,
          }),
        );
        await postLargeGeneratingEntry(context, {
          planned: plan.detailCalls,
          missing,
        });
      }),
    async onDetailStart() {
      context.watch.pin();
      log.info(
        "generate: detail calls started, a push no longer ends this run",
      );
    },
  };

  return {
    hooks,
    gitAttributes,
    detailConcurrency: deps.detailConcurrency,
    forceMultiCall: deps.forceMultiCall,
    deleteParts: () => sweepSpanParts(context),
    loadStoredParts: () =>
      runHookStep(async () => {
        await readStored();
      }),
    async discardPartsOnMergeFailure(error) {
      const deterministic = isPermanentFailure(error) && hasEveryDetailPart();
      if (!deterministic) {
        return;
      }
      log.warn(
        "generate: the merge over the stored parts failed for good, deleting them so a re-trigger regenerates",
      );
      await sweepSpanParts(context);
    },
  };
}
