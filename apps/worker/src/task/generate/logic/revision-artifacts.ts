import {
  buildComparisonMarks,
  categorizeRevisionNarrative,
  type ComparisonMarks,
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
import {
  MarksDuties,
  MarksStates,
  type MarksDuty,
  type MarksState,
  type RevisionArtifactInputs,
} from "../types";
import { getGenerationOrigin } from "../utils";
import { warnOnFailedCheck } from "./artifact-check";
import { OutputSecretError } from "./output-secret";
import {
  dropStaleMarks,
  readMarksState,
  writeSpanMarks,
  type SpanKey,
} from "./span-marks";

/**
 * The key's marks and the revision narrative over the span's filtered diff.
 * Marks never certify a core computed from other bases: with no narrative and
 * no delta stored under the key they go first, so a run stopped at the
 * narrative still leaves the span readable; otherwise they follow the
 * narrative, and where a checkpoint shares the key and a delta is stored
 * under it, that delta is rewritten first and the delta step writes them.
 * Stale marks are dropped before the narrative is rewritten. An unchanged
 * span writes the no-change record, with no spend charge and no model call.
 */
export async function writeRevisionArtifacts(
  payload: ParsedGeneratePayload,
  inputs: RevisionArtifactInputs,
): Promise<MarksDuty> {
  const { store, span, prevBrief, generatedBrief, refs } = inputs;
  const key = {
    pullRequestId: payload.pullRequestId,
    baselineSha: prevBrief.headSha,
    headSha: payload.headSha,
  };
  const marksState = await readMarksState(store, key, refs);
  if (generatedBrief === undefined) {
    // Nothing to narrate: the stored refs hold, or the stored brief could not be read back.
    const isCurrent = marksState === MarksStates.CURRENT;
    return isCurrent ? MarksDuties.CURRENT : MarksDuties.WITHHELD;
  }

  const record = {
    ...inputs,
    generatedBrief,
    dropStaleMarks: () => dropStaleMarks(store, key, refs),
  };
  const marks = buildRevisionMarks(payload, inputs);
  const isKeyEmpty = await isSpanKeyEmpty(store, key, marksState);
  if (isKeyEmpty) {
    await writeSpanMarks(store, payload.pullRequestId, marks, refs);
  }
  const narrated = span.isUnchanged
    ? await writeUnchangedNarrative(payload, record)
    : await writeSpanNarrative(payload, record, marks.files);
  if (isKeyEmpty) {
    return MarksDuties.CURRENT;
  }
  // A failed narrative leaves the stored one: marks from new refs must not certify it.
  if (!narrated && marksState !== MarksStates.CURRENT) {
    return MarksDuties.WITHHELD;
  }

  if (await isSharedDeltaStale(inputs, key, marksState)) {
    return MarksDuties.AFTER_SHARED_DELTA;
  }
  await writeSpanMarks(store, payload.pullRequestId, marks, refs);
  return MarksDuties.CURRENT;
}

/** No marks, narrative or delta stored under the key: marks written now certify nothing older. */
async function isSpanKeyEmpty(
  store: RevisionArtifactInputs["store"],
  key: SpanKey,
  marksState: MarksState,
): Promise<boolean> {
  if (marksState !== MarksStates.ABSENT) {
    return false;
  }
  const { pullRequestId, baselineSha, headSha } = key;
  const [narrative, delta] = await Promise.all([
    store.revisionNarratives.get(pullRequestId, baselineSha, headSha),
    store.deltas.get(pullRequestId, baselineSha, headSha),
  ]);
  return narrative === undefined && delta === undefined;
}

/** A checkpoint delta stored under the key the marks would certify, not yet rewritten from these refs. */
async function isSharedDeltaStale(
  inputs: RevisionArtifactInputs,
  key: SpanKey,
  marksState: MarksState,
): Promise<boolean> {
  if (!inputs.checkpointSharesSpan || marksState === MarksStates.CURRENT) {
    return false;
  }
  const { pullRequestId, baselineSha, headSha } = key;
  const stored = await inputs.store.deltas.get(
    pullRequestId,
    baselineSha,
    headSha,
  );
  return stored !== undefined;
}

/** The span's marks as the previous-brief comparison reads them. */
function buildRevisionMarks(
  payload: ParsedGeneratePayload,
  inputs: Pick<RevisionArtifactInputs, "span" | "prevBrief">,
): ComparisonMarks {
  return buildComparisonMarks(
    payload.headSha,
    inputs.prevBrief.headSha,
    "previous-brief",
    inputs.prevBrief.headIndex,
    inputs.span.filteredDiff,
  );
}

/** The config gate still wins: the owner turned the narrative off. Always written, so true. */
async function writeUnchangedNarrative(
  payload: ParsedGeneratePayload,
  record: NarrativeCallInputs,
): Promise<boolean> {
  const skipped = resolveNarrativeSkip(record.revisionNarrative, false);
  if (skipped !== undefined) {
    await writeSkippedNarrative(payload, record, skipped);
    return true;
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
  return true;
}

/**
 * The gate, the ratio and the call limits all run before the spend charge.
 * False only when the narrative call failed and wrote nothing.
 */
async function writeSpanNarrative(
  payload: ParsedGeneratePayload,
  record: NarrativeCallInputs,
  marksFiles: NonNullable<RevisionNarrativeInput["marksFiles"]>,
): Promise<boolean> {
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
    return true;
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
    return true;
  }

  await record.chargeSpend();
  return writeGeneratedNarrative(payload, record, narrativeInput);
}

/** Best-effort: a failed narrative never fails the Brief, and answers false. */
async function writeGeneratedNarrative(
  payload: ParsedGeneratePayload,
  record: NarrativeCallInputs,
  narrativeInput: RevisionNarrativeInput,
): Promise<boolean> {
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
    return true;
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
      return false;
    }
    log.warn(message);
    return false;
  }
}

/** What a narrative record for the span names: no marks and no diff. */
export interface NarrativeRecordInputs extends Pick<
  RevisionArtifactInputs,
  "store" | "prevBrief" | "briefRef" | "log"
> {
  readonly generatedBrief: Brief;
  /** Runs right before the record is written: stale marks must not certify it. */
  readonly dropStaleMarks: () => Promise<void>;
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

  await inputs.dropStaleMarks();
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
