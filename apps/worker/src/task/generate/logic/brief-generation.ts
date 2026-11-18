import {
  countPullRequestSecrets,
  generateBrief,
  type Brief,
  type FetchedPr,
  type GenerateBriefOptions,
} from "brief-core";
import {
  checkBriefForWrite,
  readStoredBrief,
  STORED_BODY_VERSION,
} from "brief-core/artifact";
import {
  countBriefChunkLayouts,
  type ChunkLayoutBody,
} from "brief-core/chunk-layout";
import { GenerationKinds, type BriefWriteInput } from "persistence";
import { GenerationPhases, type GenerationPhase } from "types/generations";
import type { Mutable } from "types/utils";
import { buildEntryCommentGeneratingBody } from "../../entry-comment";
import type { ParsedGeneratePayload } from "../../payload";
import { buildRepoConfigArtifact } from "../../repo-config";
import {
  MarksStates,
  type BriefGenerationInputs,
  type StoredBriefLayoutInputs,
  type GeneratedBrief,
  type StoredBriefRecoveryInputs,
} from "../types";
import {
  deriveNextHeadIndex,
  getAnchorColumns,
  getGenerationOrigin,
  recoverBrief,
} from "../utils";
import { decideAnchor } from "./anchor-decision";
import { collectAllowedRiskNames, warnOnFailedCheck } from "./artifact-check";
import { runGenerator } from "./errors";
import { postGeneratingEntry } from "./generating-entry";
import { readLockfileSummaries } from "./lockfile-summaries";
import { LockfileSpanKinds } from "./lockfile-summaries/types";
import { readSpanBaseRefs } from "./revision-span";
import { readMarksState } from "./span-marks";
import { throwOnClaimLost } from "./supersession-watch";

/**
 * The fresh-brief path: anchor decision, the generating Entry, brief-core's
 * generation, and the brief write with its chunk-layout sidecar. The anchor
 * decision runs BEFORE the GENERATING phase mark.
 */
export async function writeFreshBrief(
  payload: ParsedGeneratePayload,
  inputs: BriefGenerationInputs,
): Promise<GeneratedBrief> {
  const {
    fullRegeneration,
    anchorGenerator,
    effort,
    store,
    source,
    entryCommentAllowed,
    priorBriefs,
    prevBrief,
    prevSpanRead,
    prInfo,
    diff,
    locator,
    meta,
    repoConfig,
    loadContext,
    generator,
    coreMessageLog,
    multiCall,
    log,
  } = inputs;
  const { pullRequestId, headSha } = payload;

  const headIndex = deriveNextHeadIndex(priorBriefs);
  const {
    anchor: decided,
    previous,
    chainGroupIds,
  } = await decideAnchor(payload, {
    store,
    fullRegeneration,
    generator: anchorGenerator,
    effort,
    prevBrief,
    priorBriefs,
    prevSpan: prevSpanRead?.ok === true ? prevSpanRead.value : undefined,
    log,
  });
  await multiCall.loadStoredParts(previous);
  await advancePhase(inputs, GenerationPhases.GENERATING);
  if (entryCommentAllowed) {
    await postFreshGeneratingEntry(inputs, headIndex);
  }
  const { links, primaryTicket } = await loadContext();
  const fetchedPr: FetchedPr = { locator, meta, diff, links };
  if (primaryTicket !== undefined) {
    fetchedPr.primaryTicket = primaryTicket;
  }
  const lockfileSummaries = await readLockfileSummaries(
    source,
    diff,
    {
      kind: LockfileSpanKinds.PULL_REQUEST,
      base: prInfo.baseSha,
      head: headSha,
    },
    log,
    inputs.stops,
  );
  const secretKinds = countPullRequestSecrets(fetchedPr);
  if (Object.keys(secretKinds).length > 0) {
    log.debug("generate: secrets redacted from the prompt", { secretKinds });
  }
  const options: GenerateBriefOptions = {
    pr: fetchedPr,
    headIndex,
    commitRange: {
      base: prInfo.baseSha,
      head: headSha,
      commitCount: prInfo.commitCount,
    },
    generator,
    effort,
    repoContext: repoConfig?.repoContext,
    log: coreMessageLog,
    previous,
    lockfileSummaries,
    gitAttributes: multiCall.gitAttributes,
    detailConcurrency: multiCall.detailConcurrency,
    forceMultiCall: multiCall.forceMultiCall,
    multiCallHooks: multiCall.hooks,
  };
  const { brief, anchoring } = await runGenerator(
    () => generateBrief(options),
    log,
    GenerationKinds.BRIEF,
  );
  await advancePhase(inputs, GenerationPhases.WRITING);
  const carriedChunkIds = anchoring?.carriedChunkIds ?? [];
  const stamped: Brief = { ...brief, anchor: decided };
  const briefWrite: Mutable<BriefWriteInput> = {
    pullRequestId,
    baseSha: prInfo.baseSha,
    headSha,
    headIndex,
    commitCount: prInfo.commitCount,
    ...getGenerationOrigin(brief.generation),
    body: JSON.stringify(stamped),
    bodyVersion: STORED_BODY_VERSION,
    ...getAnchorColumns(decided),
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
    briefWrite.repoConfig = buildRepoConfigArtifact(repoConfig, stamped.chunks);
  }

  const customAttributes = repoConfig?.repoContext?.customAttributes ?? [];
  const customNames = customAttributes.map((attribute) => attribute.name);
  const allowedNames = collectAllowedRiskNames(
    customNames,
    stamped.chunks,
    carriedChunkIds,
  );
  const briefCheck = checkBriefForWrite(stamped, allowedNames);
  warnOnFailedCheck(briefCheck, GenerationKinds.BRIEF, log);
  const chunkLayout = countStoredBriefLayouts(diff, briefWrite.body);
  if (chunkLayout !== undefined) {
    briefWrite.chunkLayout = chunkLayout;
  }

  const written = await store.briefs.write(briefWrite);
  await multiCall.deleteParts();
  const briefRef = { id: written.id, headIndex: written.headIndex };

  return { briefRef, generatedBrief: stamped };
}

/**
 * The cards' counts from the body as a reader parses it, so a remainder
 * card's ranges, orphaned chunks folded in, are the ones counted. A body
 * that does not read stores no sidecar.
 */
function countStoredBriefLayouts(
  diff: string,
  body: string,
): ChunkLayoutBody | undefined {
  const read = readStoredBrief(body);
  if (!read.ok) {
    return undefined;
  }

  const { chunks, unattributed = [] } = read.value.brief;
  return countBriefChunkLayouts(diff, { chunks, unattributed });
}

/**
 * A run over the stored brief backfills its sidecar when the brief has
 * none (written before this sidecar existed, or by a writer that passes no
 * counts), so the page does not stay on its estimate for good.
 */
export async function backfillMissingChunkLayout(
  inputs: StoredBriefLayoutInputs,
): Promise<void> {
  const { store, pullRequestId, storedBrief, diff } = inputs;
  if (await store.chunkLayouts.has(storedBrief.id)) {
    return;
  }
  const { baseSha, headSha } = storedBrief;
  const row = await store.briefs.get(pullRequestId, baseSha, headSha);
  if (row === undefined) {
    return;
  }
  const body = countStoredBriefLayouts(diff, row.body);
  if (body === undefined) {
    return;
  }

  await store.chunkLayouts.backfill({ pullRequestId, briefId: row.id, body });
}

async function postFreshGeneratingEntry(
  inputs: BriefGenerationInputs,
  headIndex: number,
): Promise<void> {
  const { watch, translate, entryCommentManager, prInfo, log } = inputs;
  const generatingBody = buildEntryCommentGeneratingBody(
    translate,
    entryCommentManager.buildDeepLink(headIndex),
  );
  await postGeneratingEntry(
    { watch, entryCommentManager, headSha: prInfo.headSha, log },
    generatingBody,
  );
}

async function advancePhase(
  inputs: BriefGenerationInputs,
  phase: GenerationPhase,
): Promise<void> {
  const { projection, target, runId } = inputs;
  throwOnClaimLost(await projection.advanceRun(target, runId, phase));
}

/**
 * Retry-resume for the skip path: a prior attempt wrote the brief but may
 * have died before the narrative or the marks, or the span's refs moved
 * since (a same-head retarget back onto a briefed base), so recover the
 * Brief from the stored body unless the narrative is stored under marks
 * written from the refs resolved now. Undefined means nothing to narrate.
 */
export async function recoverStoredBrief(
  payload: ParsedGeneratePayload,
  inputs: StoredBriefRecoveryInputs,
): Promise<Brief | undefined> {
  const { store, prevBrief, baseSha, log } = inputs;
  const { pullRequestId, headSha } = payload;
  if (prevBrief === undefined) {
    return undefined;
  }

  const key = { pullRequestId, baselineSha: prevBrief.headSha, headSha };
  const refs = readSpanBaseRefs(prevBrief, baseSha);
  const [storedNarrative, marksState] = await Promise.all([
    store.revisionNarratives.get(pullRequestId, prevBrief.headSha, headSha),
    readMarksState(store, key, refs),
  ]);
  const isNarrated =
    storedNarrative !== undefined && marksState === MarksStates.CURRENT;
  if (isNarrated) {
    return undefined;
  }

  const fullRow = await store.briefs.get(pullRequestId, baseSha, headSha);
  const recovered =
    fullRow === undefined ? undefined : recoverBrief(fullRow.body, log);
  return recovered?.ok ? recovered.value : undefined;
}
