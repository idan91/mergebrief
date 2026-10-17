import {
  generateBrief,
  type Brief,
  type FetchedPr,
  type GenerateBriefOptions,
} from "brief-core";
import { checkBriefForWrite, STORED_BODY_VERSION } from "brief-core/artifact";
import { GenerationKinds, type BriefWriteInput } from "persistence";
import { GenerationPhases, type GenerationPhase } from "types/generations";
import type { Mutable } from "types/utils";
import { entryCommentGeneratingBody } from "../../entry-comment";
import type { ParsedGeneratePayload } from "../../payload";
import { buildRepoConfigArtifact } from "../../repo-config";
import type {
  BriefGenerationInputs,
  GeneratedBrief,
  StoredBriefRecoveryInputs,
} from "../types";
import { getAnchorColumns, getGenerationOrigin, recoverBrief } from "../utils";
import { decideAnchor } from "./anchor-decision";
import { collectAllowedRiskNames, warnOnFailedCheck } from "./artifact-check";
import { runGenerator } from "./errors";
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
    entryCommentManager,
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
    log,
  } = inputs;
  const { pullRequestId, headSha } = payload;

  const headIndex = (priorBriefs.at(-1)?.headIndex ?? 0) + 1;
  const { anchor, previous, chainGroupIds } = await decideAnchor(payload, {
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
  await advancePhase(inputs, GenerationPhases.GENERATING);
  if (entryCommentAllowed) {
    const generatingBody = entryCommentGeneratingBody(
      entryCommentManager.buildDeepLink(headIndex),
    );
    await entryCommentManager.refresh(generatingBody);
  }
  const { links, primaryTicket } = await loadContext();
  const fetchedPr: FetchedPr = { locator, meta, diff, links };
  if (primaryTicket !== undefined) {
    fetchedPr.primaryTicket = primaryTicket;
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
  };
  const { brief, anchoring } = await runGenerator(
    () => generateBrief(options),
    log,
    GenerationKinds.BRIEF,
  );
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
  const briefRef = { id: written.id, headIndex: written.headIndex };

  return { briefRef, generatedBrief: stamped };
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
