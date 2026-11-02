import {
  buildComparisonMarks,
  categorizeRevisionNarrative,
  countChangedLines,
  exceedsNarrativeCallLimits,
  isHugeSpan,
  type Brief,
  type RevisionNarrativeConfig,
  type RevisionNarrativeInput,
  type RevisionNarrativeSkipped,
} from "brief-core";
import {
  checkRevisionNarrativeForWrite,
  STORED_BODY_VERSION,
  type StoredRevisionNarrative,
} from "brief-core/artifact";
import {
  RevisionNarrativeSkipReasons,
  type RevisionNarrativeSkipReason,
  type RevisionNarrativeUnchanged,
} from "brief-core/types";
import { GenerationKinds } from "persistence";
import type { ParsedGeneratePayload } from "../../payload";
import type { RevisionArtifactInputs } from "../types";
import { getGenerationOrigin } from "../utils";
import { warnOnFailedCheck } from "./artifact-check";
import { OutputSecretError } from "./output-secret";

/**
 * Comparison marks (mechanical, always) + revision narrative (generated,
 * best-effort, a narrative failure never fails the Brief, mirroring
 * `generateAndWrite`), both over the span's filtered diff. Marks are written
 * BEFORE the narrative call so a failed narrative still leaves highlights
 * available. An unchanged span writes zero-file marks and the no-change
 * record, with no spend charge and no model call.
 */
export async function writeRevisionArtifacts(
  payload: ParsedGeneratePayload,
  inputs: RevisionArtifactInputs,
): Promise<void> {
  const { store, span, prevBrief, generatedBrief } = inputs;
  const { pullRequestId, headSha } = payload;

  const marks = buildComparisonMarks(
    headSha,
    prevBrief.headSha,
    "previous-brief",
    prevBrief.headIndex,
    span.filteredDiff,
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

  const record = { ...inputs, generatedBrief };
  if (span.isUnchanged) {
    await writeUnchangedNarrative(payload, record);
    return;
  }
  await writeSpanNarrative(payload, record, marks.files);
}

/** The config gate still wins: the owner turned the narrative off. */
async function writeUnchangedNarrative(
  payload: ParsedGeneratePayload,
  record: NarrativeCallInputs,
): Promise<void> {
  const skipped = resolveNarrativeSkip(record.revisionNarrative, false);
  if (skipped !== undefined) {
    await writeSkippedNarrative(payload, record, skipped);
    return;
  }

  const { generatedBrief, prevBrief, briefRef } = record;
  const unchanged: RevisionNarrativeUnchanged = {
    artifactKind: "revisionNarrativeUnchanged",
    pr: generatedBrief.pr,
    prevHeadSha: prevBrief.headSha,
    headSha: payload.headSha,
    prevIndex: prevBrief.headIndex,
    headIndex: briefRef.headIndex,
  };
  await writeNarrativeRecord(
    payload,
    record,
    unchanged,
    generatedBrief.generation,
  );
  record.log.info(
    "generate: revision span unchanged; wrote the no-change record",
  );
}

/** The gate, the ratio and the call limits all run before the spend charge. */
async function writeSpanNarrative(
  payload: ParsedGeneratePayload,
  record: NarrativeCallInputs,
  marksFiles: NonNullable<RevisionNarrativeInput["marksFiles"]>,
): Promise<void> {
  const { locator, meta, span, prevBrief, briefRef, log } = record;
  const revDiff = span.filteredDiff;
  const revSpanHuge = isHugeSpan(
    countChangedLines(revDiff),
    record.wholePrChangedLines,
    record.hugeSpanRatio,
  );
  const skipped = resolveNarrativeSkip(record.revisionNarrative, revSpanHuge);
  if (skipped !== undefined) {
    await writeSkippedNarrative(payload, record, skipped);
    return;
  }

  // Supersession gate and spend charge BEFORE the narrative call; deliberately
  // outside the try, a supersession or a cap refusal must propagate, never be
  // swallowed as a narrative failure.
  await record.watch.assertCurrent();
  const { links, primaryTicket } = await record.loadContext();
  const narrativeInput: RevisionNarrativeInput = {
    locator,
    meta,
    prevHeadSha: prevBrief.headSha,
    headSha: payload.headSha,
    prevIndex: prevBrief.headIndex,
    headIndex: briefRef.headIndex,
    incrementalDiff: revDiff,
    links,
    primaryTicket,
    brief: record.generatedBrief,
    marksFiles,
  };
  if (exceedsNarrativeCallLimits(narrativeInput)) {
    await writeSkippedNarrative(
      payload,
      record,
      RevisionNarrativeSkipReasons.SPAN_TOO_LARGE,
    );
    log.info("generate: revision span past the call limits; wrote skip stub");
    return;
  }

  await record.chargeSpend();
  await writeGeneratedNarrative(payload, record, narrativeInput);
}

/** Best-effort: a failed narrative never fails the Brief. */
async function writeGeneratedNarrative(
  payload: ParsedGeneratePayload,
  record: NarrativeCallInputs,
  narrativeInput: RevisionNarrativeInput,
): Promise<void> {
  const { log } = record;
  try {
    const narrative = await categorizeRevisionNarrative(
      narrativeInput,
      record.generator,
      (message) => log.info(message),
      record.effort,
    );
    await writeNarrativeRecord(
      payload,
      record,
      narrative,
      narrative.generation,
    );
  } catch (error) {
    // A newer push or a shutdown stopped the call: the run settles that, and
    // a shutdown's retry still owes the narrative.
    const stopped = record.stops.some((signal) => signal?.aborted === true);
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

/** What a narrative record for the span names: no marks and no diff. */
export interface NarrativeRecordInputs extends Pick<
  RevisionArtifactInputs,
  "store" | "prevBrief" | "briefRef" | "log"
> {
  readonly generatedBrief: Brief;
}

/** The one place the skip reason is decided: the config gate outranks size. */
export function resolveNarrativeSkip(
  gate: RevisionNarrativeConfig | undefined,
  isSpanTooLarge: boolean,
): RevisionNarrativeSkipReason | undefined {
  if (gate?.enabled === false) {
    return RevisionNarrativeSkipReasons.DISABLED_BY_CONFIG;
  }
  if (isSpanTooLarge) {
    return RevisionNarrativeSkipReasons.SPAN_TOO_LARGE;
  }
  return undefined;
}

type NarrativeCallInputs = RevisionArtifactInputs & NarrativeRecordInputs;

/** The span's skip record, written where no narrative call will run. */
export async function writeSkippedNarrative(
  payload: ParsedGeneratePayload,
  inputs: NarrativeRecordInputs,
  skipped: RevisionNarrativeSkipped["skipped"],
): Promise<void> {
  const { generatedBrief, prevBrief, briefRef } = inputs;
  const stub: RevisionNarrativeSkipped = {
    artifactKind: "revisionNarrativeSkipped",
    pr: generatedBrief.pr,
    prevHeadSha: prevBrief.headSha,
    headSha: payload.headSha,
    prevIndex: prevBrief.headIndex,
    headIndex: briefRef.headIndex,
    skipped,
  };
  await writeNarrativeRecord(payload, inputs, stub, generatedBrief.generation);
  inputs.log.info("generate: wrote the revision narrative skip stub", {
    skipped,
  });
}

async function writeNarrativeRecord(
  payload: ParsedGeneratePayload,
  inputs: NarrativeRecordInputs,
  narrative: StoredRevisionNarrative,
  origin: Brief["generation"],
): Promise<void> {
  const { store, prevBrief, briefRef, log } = inputs;
  const narrativeCheck = checkRevisionNarrativeForWrite(narrative);
  warnOnFailedCheck(narrativeCheck, GenerationKinds.REVISION_NARRATIVE, log);

  await store.revisionNarratives.write({
    pullRequestId: payload.pullRequestId,
    briefId: briefRef.id,
    prevHeadSha: prevBrief.headSha,
    headSha: payload.headSha,
    ...getGenerationOrigin(origin),
    body: JSON.stringify(narrative),
    bodyVersion: STORED_BODY_VERSION,
  });
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
