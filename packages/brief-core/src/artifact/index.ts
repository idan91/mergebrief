import type { z } from "zod/v4";
import type { Result } from "types/utils";
import { DeltaBriefSchema, type Brief, type ChangeGroup } from "../types";
import {
  normalizeGroupMembership,
  reportSharedGroupIds,
} from "./logic/group-membership";
import {
  dropInvalidBriefSections,
  dropUnorderedReadingOrder,
} from "./logic/optional-sections";
import {
  buildStoredBriefSchema,
  StoredBriefReadSchema,
  StoredDeltaBriefReadSchema,
  StoredRevisionNarrativeReadSchema,
  StoredRevisionNarrativeSchema,
} from "./schemas";
import { isRecord, parseStored } from "./utils";
import {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type BriefWriteCheck,
  type DeltaBriefWriteCheck,
  type RevisionNarrativeWriteCheck,
  type StoredBrief,
  type StoredBriefRead,
  type StoredBriefReadResult,
  type StoredDeltaBriefReadResult,
  type StoredParse,
  type StoredRevisionNarrativeReadResult,
} from "./types";

export { STORED_BODY_VERSION } from "./consts";
export {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type ArtifactIssueCode,
  type BriefWriteCheck,
  type DeltaBriefWriteCheck,
  type RevisionNarrativeWriteCheck,
  type StoredBrief,
  type StoredBriefRead,
  type StoredBriefReadResult,
  type StoredDeltaBriefReadResult,
  type StoredRevisionNarrative,
  type StoredRevisionNarrativeReadResult,
} from "./types";

const NOT_JSON_MESSAGE = "Body is not JSON";
const NOT_AN_OBJECT_MESSAGE = "Expected a JSON object";

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

/** Refuses two changed groups sharing an id. */
export function checkDeltaBriefForWrite(delta: unknown): DeltaBriefWriteCheck {
  const checked = parseStored(DeltaBriefSchema, delta);
  const groups = checked.ok ? checked.value.changedGroups : undefined;
  return refuseSharedGroupIds(checked, groups, "changedGroups");
}

export function checkRevisionNarrativeForWrite(
  body: unknown,
): RevisionNarrativeWriteCheck {
  return parseStored(StoredRevisionNarrativeSchema, body);
}

function parseJson(json: string): Result<unknown, ArtifactIssue[]> {
  try {
    const value: unknown = JSON.parse(json);
    return { ok: true, value };
  } catch {
    const code = ArtifactIssueCodes.NOT_JSON;
    return {
      ok: false,
      error: [{ code, path: "", message: NOT_JSON_MESSAGE }],
    };
  }
}

function parseJsonObject(
  json: string,
): Result<Record<string, unknown>, ArtifactIssue[]> {
  const parsed = parseJson(json);
  if (!parsed.ok) {
    return parsed;
  }

  const { value } = parsed;
  const isObject = isRecord(value);
  if (!isObject) {
    const code = ArtifactIssueCodes.INVALID;
    const issue = { code, path: "", message: NOT_AN_OBJECT_MESSAGE };
    return { ok: false, error: [issue] };
  }

  return { ok: true, value };
}

function readStored<Stored>(
  schema: z.ZodType<Stored>,
  json: string,
): Result<Stored, ArtifactIssue[]> {
  const body = parseJsonObject(json);
  if (!body.ok) {
    return body;
  }

  return parseStored(schema, body.value);
}

/**
 * Reads a stored Brief body of any age. Fails on a broken core, drops an
 * invalid optional section, mints a missing group id, keeps groups sharing an
 * id, normalizes legacy group membership, and reports every one of those in
 * `issues`. No body makes it throw.
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
  const membership = normalizeGroupMembership(changeGroups, chunks);
  if (!membership.ok) {
    return membership;
  }

  const ordered = dropUnorderedReadingOrder({
    ...rest,
    changeGroups: membership.value.changeGroups,
    chunks: membership.value.chunks,
  });
  const read: StoredBriefRead = {
    brief: ordered.brief,
    issues: [
      ...sections.dropped,
      ...membership.value.issues,
      ...ordered.dropped,
    ],
  };
  return { ok: true, value: read };
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

/**
 * Accepts both the generated narrative and the skipped stub, and strips a key
 * it does not know.
 */
export function readStoredRevisionNarrative(
  json: string,
): StoredRevisionNarrativeReadResult {
  return readStored(StoredRevisionNarrativeReadSchema, json);
}
