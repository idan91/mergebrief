import {
  CallPlanKinds,
  countPullRequestSecrets,
  generateBrief,
  type Brief,
  type FetchedPr,
  type GenerateBriefOptions,
} from "brief-core";
import { checkBriefForWrite, STORED_BODY_VERSION } from "brief-core/artifact";
import type { Anchor } from "generators";
import type { Logger } from "logging";
import { GenerationKinds, type BriefWriteInput } from "persistence";
import {
  AnchorStates,
  GenerationPhases,
  type GenerationPhase,
} from "types/generations";
import type { Mutable, ValueOf } from "types/utils";
import { buildEntryCommentGeneratingBody } from "../../entry-comment";
import type { ParsedGeneratePayload } from "../../payload";
import { buildRepoConfigArtifact } from "../../repo-config";
import type {
  BriefGenerationInputs,
  GeneratedBrief,
  StoredBriefRecoveryInputs,
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
import { throwOnClaimLost } from "./supersession-watch";

/**
 * The fresh-brief path: anchor decision, the generating Entry, brief-core's
 * generation and the brief write. The anchor decision runs BEFORE the
 * GENERATING phase mark.
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
    prevSpanFetch,
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
    source,
    fullRegeneration,
    generator: anchorGenerator,
    effort,
    prevBrief,
    priorBriefs,
    prevSpanFetch,
    baseSha: prInfo.baseSha,
    log,
  });
  await multiCall.loadStoredParts();
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
    { base: prInfo.baseSha, head: headSha },
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
  const { brief, anchoring, ranAs } = await runGenerator(
    () => generateBrief(options),
    log,
    GenerationKinds.BRIEF,
  );
  const anchor = readStampedAnchor(decided, ranAs, log);
  await advancePhase(inputs, GenerationPhases.WRITING);
  const carriedChunkIds = anchoring?.carriedChunkIds ?? [];
  const stamped: Brief = { ...brief, anchor };
  const briefWrite: Mutable<BriefWriteInput> = {
    pullRequestId,
    baseSha: prInfo.baseSha,
    headSha,
    headIndex,
    commitCount: prInfo.commitCount,
    ...getGenerationOrigin(brief.generation),
    body: JSON.stringify(stamped),
    bodyVersion: STORED_BODY_VERSION,
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

  const written = await store.briefs.write(briefWrite);
  await multiCall.deleteParts();
  const briefRef = { id: written.id, headIndex: written.headIndex };

  return { briefRef, generatedBrief: stamped };
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
    { watch, entryCommentManager, translate, headSha: prInfo.headSha, log },
    generatingBody,
  );
}

/**
 * A multi-call run re-looks every group and anchors on nothing, whatever the
 * anchor decision planned: an anchored plan is stamped `none`, a fresh
 * restart keeps its reason. The group ids still descend past the chain's.
 */
function readStampedAnchor(
  decided: Anchor,
  ranAs: ValueOf<typeof CallPlanKinds>,
  log: Logger,
): Anchor {
  const reLooked =
    ranAs === CallPlanKinds.MULTI && decided.state === AnchorStates.ANCHORED;
  if (!reLooked) {
    return decided;
  }
  log.info(
    "generate: the multi-call run re-looked every group, the brief anchors on nothing",
  );
  return { state: AnchorStates.NONE };
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
 * have died before the narrative, so recover the Brief from the stored body
 * when no narrative exists yet. Undefined means nothing to narrate.
 */
export async function recoverStoredBrief(
  payload: ParsedGeneratePayload,
  inputs: StoredBriefRecoveryInputs,
): Promise<Brief | undefined> {
  const { store, prevBrief, baseSha, log } = inputs;
  const { pullRequestId, headSha } = payload;
  let generatedBrief: Brief | undefined;

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
      const fullRow = await store.briefs.get(pullRequestId, baseSha, headSha);
      const recovered =
        fullRow === undefined ? undefined : recoverBrief(fullRow.body, log);
      generatedBrief = recovered?.ok ? recovered.value : undefined;
    }
  }

  return generatedBrief;
}
