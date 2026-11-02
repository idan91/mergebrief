import { DeltaBriefSchema, type Brief, type ChangeGroup } from "../types";
import {
  splitGroupMembership,
  reportSharedGroupIds,
} from "./logic/group-membership";
import {
  dropInvalidBriefSections,
  dropInvalidNarrativeSections,
  dropUnorderedReadingOrder,
} from "./logic/optional-sections";
import { addChunksToRemainder } from "./logic/remainder";
import { dropMalformedRiskTokens } from "./logic/risk-tokens";
import {
  buildStoredBriefSchema,
  DeltaSkippedSchema,
  DeltaUnchangedSchema,
  StoredBriefReadSchema,
  StoredDeltaBriefReadSchema,
  StoredRevisionNarrativeReadSchema,
  StoredRevisionNarrativeSchema,
} from "./schemas";
import {
  DELTA_SKIPPED_KIND,
  DELTA_UNCHANGED_KIND,
  REVISION_NARRATIVE_UNCHANGED_KIND,
} from "./consts";
import { isRecord, parseJsonObject, parseStored, readStored } from "./utils";
import {
  ArtifactIssueCodes,
  type BriefWriteCheck,
  type DeltaWriteCheck,
  type RevisionNarrativeWriteCheck,
  type StoredBrief,
  type StoredBriefRead,
  type StoredBriefReadResult,
  type StoredDeltaBriefReadResult,
  type StoredDeltaReadResult,
  type StoredParse,
  type StoredRevisionNarrativeRead,
  type StoredRevisionNarrativeReadResult,
} from "./types";

export { STORED_BODY_VERSION } from "./consts";
export { ChunkLayoutBodySchema, ChunkLayoutCountsSchema } from "./schemas";
export { readBriefSessionFacts } from "./session-facts";
export {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type BriefSessionFacts,
  type FlagKey,
  type StoredBrief,
  type StoredDelta,
  type StoredRevisionNarrative,
} from "./types";

/** Runs after the parse: `extend` would drop a refinement on the schema. */
function refuseSharedGroupIds<Stored>(
  checked: StoredParse<Stored>,
  groups: readonly ChangeGroup[] | undefined,
  listPath: string,
): StoredParse<Stored> {
  const { INVALID } = ArtifactIssueCodes;
  const shared = reportSharedGroupIds(groups ?? [], listPath, INVALID);
  const keepsCheck = !checked.ok || shared.length === 0;
  if (keepsCheck) {
    return checked;
  }

  return { ok: false, error: shared };
}

/**
 * Accepts the built-in risk names plus the repo's `customNames`, and refuses
 * two groups sharing an id.
 */
export function checkBriefForWrite(
  brief: unknown,
  customNames: readonly string[],
): BriefWriteCheck {
  const checked = parseStored(buildStoredBriefSchema(customNames), brief);
  const groups = checked.ok ? checked.value.changeGroups : undefined;
  return refuseSharedGroupIds(checked, groups, "changeGroups");
}

/**
 * Accepts a Delta Brief or the span's skip or no-change record, told apart
 * by the record's `artifactKind`; refuses two changed groups sharing an id.
 */
export function checkDeltaForWrite(delta: unknown): DeltaWriteCheck {
  const kind = isRecord(delta) ? delta["artifactKind"] : undefined;
  if (kind === DELTA_SKIPPED_KIND) {
    return parseStored(DeltaSkippedSchema, delta);
  }
  if (kind === DELTA_UNCHANGED_KIND) {
    return parseStored(DeltaUnchangedSchema, delta);
  }

  const checked = parseStored(DeltaBriefSchema, delta);
  const groups = checked.ok ? checked.value.changedGroups : undefined;
  return refuseSharedGroupIds(checked, groups, "changedGroups");
}

export function checkRevisionNarrativeForWrite(
  body: unknown,
): RevisionNarrativeWriteCheck {
  return parseStored(StoredRevisionNarrativeSchema, body);
}

/**
 * Reads a stored Brief body in the current shape. Fails on a broken core,
 * drops an invalid optional section, keeps groups sharing an id, moves a chunk
 * naming no group into the unattributed remainder, and reports every one of
 * those in `issues`. No body makes it throw.
 */
export function readStoredBrief(json: string): StoredBriefReadResult {
  const body = parseJsonObject(json);
  if (!body.ok) {
    return body;
  }

  const sections = dropInvalidBriefSections(body.value);
  const parsed = parseStored(StoredBriefReadSchema, sections.body);
  if (!parsed.ok) {
    return parsed;
  }

  const { changeGroups, chunks, ...rest } = parsed.value;
  const tokens = dropMalformedRiskTokens(chunks);
  const membership = splitGroupMembership(changeGroups, tokens.chunks);
  const { orphans } = membership;
  const stored: StoredBrief = {
    ...rest,
    changeGroups: membership.changeGroups,
    chunks: membership.chunks,
  };
  if (orphans.length > 0) {
    stored.unattributed = addChunksToRemainder(
      rest.unattributed ?? [],
      orphans,
    );
  }

  const ordered = dropUnorderedReadingOrder(stored);
  const read: StoredBriefRead = {
    brief: ordered.brief,
    issues: [
      ...sections.dropped,
      ...tokens.dropped,
      ...membership.issues,
      ...ordered.dropped,
    ],
  };
  return { ok: true, value: read };
}

/** A stored delta body that is the span's skip record; a body that is not a JSON object is not one. */
export function isDeltaSkipRecord(json: string): boolean {
  const body = parseJsonObject(json);
  const isSkipRecord =
    body.ok && body.value["artifactKind"] === DELTA_SKIPPED_KIND;
  return isSkipRecord;
}

/** A stored delta body that is the span's no-change record. */
export function isDeltaUnchangedRecord(json: string): boolean {
  const body = parseJsonObject(json);
  return body.ok && body.value["artifactKind"] === DELTA_UNCHANGED_KIND;
}

/** A stored revision narrative body that is the span's no-change record. */
export function isRevisionNarrativeUnchangedRecord(json: string): boolean {
  const body = parseJsonObject(json);
  const kind = body.ok ? body.value["artifactKind"] : undefined;
  return kind === REVISION_NARRATIVE_UNCHANGED_KIND;
}

/**
 * True when the stamped sections `index`, `commitRange` and `generation` are
 * all present. The body was read with the read schema, never `BriefSchema`.
 */
export function isCompleteBrief(stored: StoredBrief): stored is Brief {
  const hasStampedSections =
    stored.index !== undefined &&
    stored.commitRange !== undefined &&
    stored.generation !== undefined;
  return hasStampedSections;
}

export function readStoredDeltaBrief(json: string): StoredDeltaBriefReadResult {
  return readStored(StoredDeltaBriefReadSchema, json);
}

/** A stored delta body: the span's skip or no-change record by its `artifactKind`, else a Delta Brief. */
export function readStoredDelta(json: string): StoredDeltaReadResult {
  const body = parseJsonObject(json);
  if (!body.ok) {
    return body;
  }

  const kind = body.value["artifactKind"];
  if (kind === DELTA_SKIPPED_KIND) {
    return parseStored(DeltaSkippedSchema, body.value);
  }
  if (kind === DELTA_UNCHANGED_KIND) {
    return parseStored(DeltaUnchangedSchema, body.value);
  }
  return parseStored(StoredDeltaBriefReadSchema, body.value);
}

/**
 * Accepts the generated narrative, the skipped stub and the no-change record, strips a key it
 * does not know, and drops or nulls a broken optional field the way the Brief
 * reader does, reporting each in `issues`.
 */
export function readStoredRevisionNarrative(
  json: string,
): StoredRevisionNarrativeReadResult {
  const body = parseJsonObject(json);
  if (!body.ok) {
    return body;
  }

  const sections = dropInvalidNarrativeSections(body.value);
  const parsed = parseStored(StoredRevisionNarrativeReadSchema, sections.body);
  if (!parsed.ok) {
    return parsed;
  }

  const read: StoredRevisionNarrativeRead = {
    narrative: parsed.value,
    issues: sections.dropped,
  };
  return { ok: true, value: read };
}
