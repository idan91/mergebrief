import {
  buildComparisonMarks,
  categorizeRevisionNarrative,
  countChangedLines,
  isHugeSpan,
  type Brief,
  type RevisionNarrativeSkipped,
} from "brief-core";
import {
  checkRevisionNarrativeForWrite,
  STORED_BODY_VERSION,
  type StoredRevisionNarrative,
} from "brief-core/artifact";
import type { Logger } from "logging";
import { GenerationKinds } from "persistence";
import type { PullRequestSource } from "../../github-port";
import type { ParsedGeneratePayload } from "../../payload";
import type { RevisionArtifactInputs } from "../types";
import { getGenerationOrigin } from "../utils";
import { warnOnFailedCheck } from "./artifact-check";
import { isPermanentGitHubError } from "./errors";
import { OutputSecretError } from "./output-secret";

/**
 * Comparison marks (mechanical, always) + revision narrative (generated,
 * best-effort, a narrative failure never fails the Brief, mirroring
 * `generateAndWrite`). Marks are written BEFORE the narrative call so a
 * failed narrative still leaves highlights available.
 */
export async function writeRevisionArtifacts(
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
  await store.comparisonMarks.write({
    pullRequestId,
    marks: {
      baselineSha: marks.baselineSha,
      headSha: marks.headSha,
      files: marks.files,
    },
  });

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
    narrative: StoredRevisionNarrative,
    origin: Brief["generation"],
  ): Promise<void> => {
    const narrativeCheck = checkRevisionNarrativeForWrite(narrative);
    warnOnFailedCheck(narrativeCheck, GenerationKinds.REVISION_NARRATIVE, log);

    await store.revisionNarratives.write({
      pullRequestId,
      briefId: briefRef.id,
      prevHeadSha,
      headSha,
      ...getGenerationOrigin(origin),
      body: JSON.stringify(narrative),
      bodyVersion: STORED_BODY_VERSION,
    });
  };

  const narrativeGate = inputs.revisionNarrative ?? { enabled: true };
  if (!narrativeGate.enabled) {
    const disabledStub = skipStub("disabled by config");
    await writeNarrative(disabledStub, generatedBrief.generation);
    return;
  }
  const revSpanHuge = isHugeSpan(
    countChangedLines(revDiff),
    inputs.wholePrChangedLines,
    inputs.hugeSpanRatio,
  );
  if (revSpanHuge) {
    const hugeSpanStub = skipStub("span too large");
    await writeNarrative(hugeSpanStub, generatedBrief.generation);
    log.info("generate: revision span too large; wrote skip stub");
    return;
  }

  // Supersession gate and spend charge BEFORE the narrative call; deliberately
  // outside the try, a supersession or a cap refusal must propagate, never be
  // swallowed as a narrative failure.
  await inputs.watch.assertCurrent();
  const { links, primaryTicket } = await inputs.loadContext();
  await inputs.chargeSpend();
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
    await writeNarrative(narrative, narrative.generation);
  } catch (error) {
    // A newer push or a shutdown stopped the call: the run settles that, and
    // a shutdown's retry still owes the narrative.
    const stopped = inputs.stops.some((signal) => signal?.aborted === true);
    if (stopped) {
      throw error;
    }
    const message = `generate: revision narrative failed (Brief unaffected): ${
      error instanceof Error ? error.message : String(error)
    }`;
    // A secret in the output means an injected PR reached one: the operator
    // acts on that now, whatever happens to the narrative.
    if (error instanceof OutputSecretError) {
      log.error(message);
      return;
    }
    log.warn(message);
  }
}

/**
 * The checkpoint span diff, or undefined when GitHub can no longer render it:
 * a single unrenderable/GC'd span must not sink the whole job (the brief is
 * already stored); the view falls back to the full Brief.
 */
export async function resolveDeltaSpanDiff(
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

/** Whole-PR churn, the huge-span denominator (metadata, not span diff). */
export function countPrChangedLines(
  files: readonly { additions: number; deletions: number }[],
): number {
  const changedLines = files.reduce(
    (sum, file) => sum + file.additions + file.deletions,
    0,
  );
  return changedLines;
}
