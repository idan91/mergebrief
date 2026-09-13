import {
  AlignmentReads,
  Categories,
  Concerns,
  Roles,
  type Brief,
  type BriefAnchor,
  type BriefChunk,
  type Category,
  type ChangeGroup,
  type ChunkLoc,
  type CommitRange,
  type Concern,
  type ConcernRollup,
  type ComparisonMarks,
  type ComparisonMarksSummary,
  type Generation,
  type IntentCheck,
  type IntentItem,
  type LengthViolation,
  type LineRange,
  type PrRef,
  type AddressedReviewComment,
  type ReadingOrderStep,
  type PrimaryTicket,
  PrimaryTicketStatuses,
  ReferenceLocations,
  type Specificity,
  type TicketAlignment,
  TicketTrackers,
  TicketUnreadReasons,
  type PrStack,
  type PrStackMember,
  type ForkPrStack,
  type LinearPrStack,
  type RevisionChangeFile,
  type UnattributedFile,
  type RevisionChanges,
  type RevisionNarrative,
  type RevisionNarrativeArtifact,
  type RevisionNarrativeChunk,
  type RiskNote,
  type RiskToken,
} from "../types";

import { NAME_MAX_CHARS, NAME_PATTERN } from "./repoConfig";
import type { Mutable, Result as SharedResult, ValueOf } from "types";

/** Shared `Result` with this module's fixed error type (a message string). */
export type Result<T> = SharedResult<T, string>;

interface ParsedChangeGroup {
  id?: string;
  title: string;
  summary: string;
  dominantCategory: Category;
  secondaryCategories: Category[];
  uncertain: boolean;
  uncertainBetween: Category[];
  coreChunkIds: string[];
  supportingChunkIds: string[];
}

type ParsedChunk = Omit<BriefChunk, "changeGroupId"> & {
  changeGroupId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isHttpUrl(value: unknown): value is string {
  if (!isString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isOneOf<T extends Record<string, string>>(
  values: T,
  value: unknown,
): value is ValueOf<T> {
  return isString(value) && Object.values(values).includes(value);
}

function stringArray(value: unknown): Result<string[]> {
  if (!Array.isArray(value) || !value.every(isString)) {
    return { ok: false, error: "Expected an array of strings" };
  }
  return { ok: true, value };
}

function categoryArray(value: unknown): Result<Category[]> {
  const parsed = stringArray(value);
  if (!parsed.ok) return parsed;
  if (
    !parsed.value.every((item): item is Category => isOneOf(Categories, item))
  ) {
    return { ok: false, error: "Expected an array of known categories" };
  }
  return { ok: true, value: parsed.value };
}

/**
 * The risk vocabulary is per-generation (built-ins ∪ that repo's custom names,
 * enforced server-side at decode time), so the FE cannot enumerate it. It CAN
 * enforce the token shape both sources share: lower kebab-case, ≤ 50 chars,
 * imported from repoConfig.ts so there is exactly ONE mirror of the contract.
 */
function isRiskToken(value: unknown): value is RiskToken {
  return (
    typeof value === "string" &&
    value.length <= NAME_MAX_CHARS &&
    NAME_PATTERN.test(value)
  );
}

function riskSurfaceArray(value: unknown): Result<RiskToken[]> {
  const parsed = stringArray(value);
  if (!parsed.ok) return parsed;
  if (!parsed.value.every((item) => isRiskToken(item))) {
    return { ok: false, error: "Expected kebab-case risk-surface tokens" };
  }
  return { ok: true, value: parsed.value };
}

function parseRiskNote(value: unknown): Result<RiskNote> {
  if (!isRecord(value))
    return { ok: false, error: "Expected risk note to be an object" };
  const attr = value["attr"];
  const note = value["note"];
  if (!isRiskToken(attr) || !isString(note)) {
    return {
      ok: false,
      error: "Expected risk note attr (kebab-case token) and note string",
    };
  }
  return { ok: true, value: { attr, note } };
}

function parsePrRef(value: unknown): Result<PrRef> {
  if (!isRecord(value))
    return { ok: false, error: "Expected pr to be an object" };
  const repo = value["repo"];
  const number = value["number"];
  const title = value["title"];
  const url = value["url"];
  const sha = value["sha"];
  const description = value["description"];
  if (
    !isString(repo) ||
    !isInteger(number) ||
    !isString(title) ||
    !isHttpUrl(url) ||
    !isString(sha) ||
    !isString(description)
  ) {
    return {
      ok: false,
      error:
        "Expected pr repo, number, title, http(s) url, sha, and description",
    };
  }
  // Lifecycle snapshot: optional, lenient, a malformed value is dropped
  // rather than failing the artifact (badge display metadata only).
  const state = value["state"];
  const draft = value["draft"];
  const merged = value["merged"];
  const headRef = value["headRef"];
  const baseRef = value["baseRef"];
  const pr: PrRef = { repo, number, title, url, sha, description };

  if (state === "open" || state === "closed") pr.state = state;
  if (typeof draft === "boolean") pr.draft = draft;
  if (typeof merged === "boolean") pr.merged = merged;
  if (typeof headRef === "string") pr.headRef = headRef;
  if (typeof baseRef === "string") pr.baseRef = baseRef;
  const stack = parsePrStack(value["stack"]);
  if (stack !== undefined) pr.stack = stack;

  return { ok: true, value: pr };
}

function isStackMember(value: unknown): value is PrStackMember {
  return (
    isRecord(value) && isInteger(value["number"]) && isString(value["title"])
  );
}

function parseLinearPrStack(
  value: Record<string, unknown>,
): LinearPrStack | undefined {
  if (!("members" in value || "index" in value)) return undefined;

  const membersValue = value["members"];
  const index = value["index"];
  if (!Array.isArray(membersValue) || !isInteger(index)) return undefined;

  const members: PrStackMember[] = [];
  for (const item of membersValue) {
    if (!isStackMember(item)) return undefined;
    members.push(item);
  }

  if (members.length < 2) return undefined;
  if (index < 1 || index > members.length) return undefined;

  return { members, index };
}

function parseForkPrStack(
  value: Record<string, unknown>,
): ForkPrStack | undefined {
  const childrenValue = value["children"];
  if (!Array.isArray(childrenValue)) return undefined;

  const children: PrStackMember[] = [];
  for (const item of childrenValue) {
    if (!isStackMember(item)) return undefined;
    children.push(item);
  }

  if (children.length < 2) return undefined;

  const fork: Mutable<ForkPrStack> = { children };
  if ("parent" in value) {
    if (!isStackMember(value["parent"])) return undefined;
    fork.parent = value["parent"];
  }

  return fork;
}

function parsePrStack(value: unknown): PrStack | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;

  const linear = parseLinearPrStack(value);
  if (linear !== undefined) return linear;

  return parseForkPrStack(value);
}

export function parseAddressedReviewComment(
  value: unknown,
): Result<AddressedReviewComment> {
  if (!isRecord(value))
    return { ok: false, error: "Expected review comment to be an object" };
  const id = value["id"];
  const file = value["file"];
  const startLine = value["startLine"] ?? null;
  const line = value["line"];
  const originalStartLine = value["originalStartLine"] ?? null;
  const originalLine = value["originalLine"] ?? null;
  const author = value["author"];
  const body = value["body"];
  const inReplyToId = value["inReplyToId"];
  const outdated = value["outdated"] ?? line === null;
  if (
    !isString(id) ||
    !isString(file) ||
    !isNullableInteger(startLine) ||
    !isNullableInteger(line) ||
    !isNullableInteger(originalStartLine) ||
    !isNullableInteger(originalLine) ||
    !isString(author) ||
    !isString(body) ||
    !isNullableString(inReplyToId) ||
    typeof outdated !== "boolean"
  ) {
    return {
      ok: false,
      error:
        "Expected review comment id, file, startLine, line, originalStartLine, originalLine, author, body, inReplyToId, and outdated",
    };
  }
  return {
    ok: true,
    value: {
      id,
      file,
      startLine,
      line,
      originalStartLine,
      originalLine,
      author,
      body,
      inReplyToId,
      outdated,
    },
  };
}

export function parseAddressedReviewComments(
  value: unknown,
): Result<AddressedReviewComment[]> {
  return parseArray(value, parseAddressedReviewComment, "reviewComments");
}

function parseLoc(value: unknown): Result<ChunkLoc> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected loc added/deleted integers" };
  }
  const added = value["added"];
  const deleted = value["deleted"];
  if (!isInteger(added) || !isInteger(deleted)) {
    return { ok: false, error: "Expected loc added/deleted integers" };
  }
  return { ok: true, value: { added, deleted } };
}

function parseLineRange(value: unknown): Result<LineRange> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected line range start/end integers" };
  }
  const start = value["start"];
  const end = value["end"];
  if (!isInteger(start) || !isInteger(end)) {
    return { ok: false, error: "Expected line range start/end integers" };
  }
  return { ok: true, value: { start, end } };
}

function parseRevisionChangeFile(value: unknown): Result<RevisionChangeFile> {
  if (!isRecord(value))
    return {
      ok: false,
      error: "Expected revision-change file to be an object",
    };
  const file = value["file"];
  if (!isString(file))
    return { ok: false, error: "Expected revision-change file path" };
  const addedRanges = parseArray(
    value["addedRanges"],
    parseLineRange,
    "addedRanges",
  );
  if (!addedRanges.ok) return addedRanges;
  const removedRanges = parseArray(
    value["removedRanges"],
    parseLineRange,
    "removedRanges",
  );
  if (!removedRanges.ok) return removedRanges;
  return {
    ok: true,
    value: {
      file,
      addedRanges: addedRanges.value,
      removedRanges: removedRanges.value,
    },
  };
}

/**
 * Optional warn-and-drop parse of the brief's `unattributed` field: absent
 * stays absent (pre-feature brief); malformed drops with a warning rather
 * than failing the whole brief.
 */
function parseUnattributed(
  value: unknown,
  warnings?: ParseWarnings,
): UnattributedFile[] | undefined {
  if (value === undefined) return undefined;
  const parsed = parseArray(value, parseRevisionChangeFile, "unattributed");
  if (!parsed.ok) {
    warnings?.warn(`unattributed dropped: ${parsed.error}`);
    return undefined;
  }
  // The engine emits canonical ranges (1-based, ordered, disjoint); the view
  // model counts with a plain sum, so a non-canonical artifact must drop
  // here rather than produce negative or duplicated totals.
  for (const entry of parsed.value) {
    for (const ranges of [entry.addedRanges, entry.removedRanges]) {
      if (!isCanonicalRanges(ranges)) {
        warnings?.warn(
          `unattributed dropped: non-canonical ranges for ${entry.file}`,
        );
        return undefined;
      }
    }
  }
  return parsed.value;
}

/** 1-based, ordered, non-overlapping (ascending, gap-free of inversions). */
function isCanonicalRanges(ranges: LineRange[]): boolean {
  let previousEnd = 0;
  for (const range of ranges) {
    if (range.start < 1 || range.end < range.start) return false;
    if (range.start <= previousEnd) return false;
    previousEnd = range.end;
  }
  return true;
}

export function parseRevisionChanges(value: unknown): Result<RevisionChanges> {
  if (!isRecord(value))
    return { ok: false, error: "Expected revision changes to be an object" };
  const headSha = value["headSha"];
  const prevHeadSha = value["prevHeadSha"];
  const prevIndex = value["prevIndex"];
  if (!isString(headSha) || !isString(prevHeadSha) || !isInteger(prevIndex)) {
    return {
      ok: false,
      error: "Expected revision changes headSha, prevHeadSha, and prevIndex",
    };
  }
  const files = parseArray(value["files"], parseRevisionChangeFile, "files");
  if (!files.ok) return files;
  return {
    ok: true,
    value: { headSha, prevHeadSha, prevIndex, files: files.value },
  };
}

const ComparisonBaselineLabels = {
  PREVIOUS_BRIEF: "previous-brief",
  CHECKPOINT: "checkpoint",
} as const;

/**
 * Parse the header fields of a `.comparison.json` marks sidecar
 * needed for comparison availability, deliberately ignores `files`, which
 * availability scanning never needs.
 */
export function parseComparisonMarksSummary(
  value: unknown,
): Result<ComparisonMarksSummary> {
  if (!isRecord(value))
    return { ok: false, error: "Expected comparison marks to be an object" };
  const baselineSha = value["baselineSha"];
  const headSha = value["headSha"];
  const baselineLabel = value["baselineLabel"];
  const baselineIndex = value["baselineIndex"] ?? null;
  if (
    !isString(baselineSha) ||
    !isString(headSha) ||
    !isOneOf(ComparisonBaselineLabels, baselineLabel) ||
    !isNullableInteger(baselineIndex)
  ) {
    return {
      ok: false,
      error:
        "Expected comparison marks baselineSha, headSha, baselineLabel, and baselineIndex",
    };
  }
  return {
    ok: true,
    value: {
      baselineSha,
      headSha,
      baselineLabel,
      baselineIndex,
    },
  };
}

/**
 * Parse a full `.comparison.json` marks sidecar: the header fields
 * (via `parseComparisonMarksSummary`) plus the per-file changed-line ranges
 * (reusing the revision-change file parser, identical `files` shape).
 */
export function parseComparisonMarks(value: unknown): Result<ComparisonMarks> {
  const summary = parseComparisonMarksSummary(value);
  if (!summary.ok) return summary;
  if (!isRecord(value))
    return { ok: false, error: "Expected comparison marks to be an object" };
  const files = parseArray(value["files"], parseRevisionChangeFile, "files");
  if (!files.ok) return files;
  return { ok: true, value: { ...summary.value, files: files.value } };
}

function parseRevisionNarrativeChunk(
  value: unknown,
): Result<RevisionNarrativeChunk> {
  if (!isRecord(value))
    return { ok: false, error: "Expected narrative chunk to be an object" };
  const id = value["id"];
  const briefChangeGroupId = value["briefChangeGroupId"];
  const file = value["file"];
  const summary = value["summary"];
  const addedRanges = parseArray(
    value["addedRanges"],
    parseLineRange,
    "addedRanges",
  );
  if (!addedRanges.ok) return addedRanges;
  const removedRanges = parseArray(
    value["removedRanges"],
    parseLineRange,
    "removedRanges",
  );
  if (!removedRanges.ok) return removedRanges;
  if (
    !isString(id) ||
    !isString(briefChangeGroupId) ||
    !isString(file) ||
    !isString(summary)
  ) {
    return {
      ok: false,
      error:
        "Expected narrative chunk id, briefChangeGroupId, file, and summary",
    };
  }
  return {
    ok: true,
    value: {
      id,
      briefChangeGroupId,
      file,
      addedRanges: addedRanges.value,
      removedRanges: removedRanges.value,
      summary,
    },
  };
}

const RevisionNarrativeSkipReasons = {
  SPAN_TOO_LARGE: "span too large",
  DISABLED_BY_CONFIG: "disabled by config",
} as const;

/**
 * Parse a fetched `.revision-narrative.json`, discriminating on
 * `artifactKind`: a real `revisionNarrative` or a `revisionNarrativeSkipped`
 * stub. The stub's `skipped` reason must be one of the two known values.
 */
export function parseRevisionNarrativeArtifact(
  value: unknown,
): Result<RevisionNarrativeArtifact> {
  if (!isRecord(value))
    return { ok: false, error: "Expected narrative artifact to be an object" };
  const artifactKind = value["artifactKind"];
  const pr = parsePrRef(value["pr"]);
  if (!pr.ok) return pr;
  const prevHeadSha = value["prevHeadSha"];
  const headSha = value["headSha"];
  const prevIndex = value["prevIndex"];
  const headIndex = value["headIndex"];
  if (
    !isString(prevHeadSha) ||
    !isString(headSha) ||
    !isInteger(prevIndex) ||
    !isInteger(headIndex)
  ) {
    return {
      ok: false,
      error:
        "Expected narrative prevHeadSha, headSha, prevIndex, and headIndex",
    };
  }

  if (artifactKind === "revisionNarrativeSkipped") {
    const skipped = value["skipped"];
    if (!isOneOf(RevisionNarrativeSkipReasons, skipped)) {
      return {
        ok: false,
        error: "Expected narrative skipped reason to be a known value",
      };
    }
    return {
      ok: true,
      value: {
        artifactKind: "revisionNarrativeSkipped",
        pr: pr.value,
        prevHeadSha,
        headSha,
        prevIndex,
        headIndex,
        skipped,
      },
    };
  }

  if (artifactKind !== "revisionNarrative") {
    return { ok: false, error: "Unknown narrative artifactKind" };
  }
  const overview = value["overview"];
  const generation = parseGeneration(value["generation"]);
  if (!isString(overview) || !generation) {
    return { ok: false, error: "Expected narrative overview and generation" };
  }
  const chunks = parseArray(
    value["chunks"],
    parseRevisionNarrativeChunk,
    "chunks",
  );
  if (!chunks.ok) return chunks;
  const generationWarnings = parseGenerationWarnings(
    value["generationWarnings"],
  );
  const lengthViolations = parseLengthViolations(value["lengthViolations"]);
  const narrative: RevisionNarrative = {
    artifactKind: "revisionNarrative",
    pr: pr.value,
    prevHeadSha,
    headSha,
    prevIndex,
    headIndex,
    generation,
    overview,
    chunks: chunks.value,
  };

  if (generationWarnings) narrative.generationWarnings = generationWarnings;
  if (lengthViolations) narrative.lengthViolations = lengthViolations;

  return { ok: true, value: narrative };
}

function parseChunk(value: unknown): Result<ParsedChunk> {
  if (!isRecord(value))
    return { ok: false, error: "Expected chunk to be an object" };
  const id = value["id"];
  const changeGroupId = value["changeGroupId"];
  const file = value["file"];
  const concern = value["concern"];
  const role = value["role"];
  const summary = value["summary"];
  const addressesComments = value["addressesComments"];
  const loc = parseLoc(value["loc"]);
  if (!loc.ok) return loc;
  const addedRanges = parseArray(
    value["addedRanges"],
    parseLineRange,
    "addedRanges",
  );
  if (!addedRanges.ok) return addedRanges;
  const removedRanges = parseArray(
    value["removedRanges"],
    parseLineRange,
    "removedRanges",
  );
  if (!removedRanges.ok) return removedRanges;
  const risks = riskSurfaceArray(value["riskSurface"]);
  if (!risks.ok) return risks;
  const riskNotes = value["riskNotes"];
  const parsedRiskNotes =
    riskNotes === undefined
      ? ({ ok: true, value: [] } satisfies Result<RiskNote[]>)
      : parseArray(riskNotes, parseRiskNote, "riskNotes");
  if (!parsedRiskNotes.ok) return parsedRiskNotes;
  const parsedAddressesComments =
    addressesComments === undefined
      ? ({ ok: true, value: [] } satisfies Result<string[]>)
      : stringArray(addressesComments);
  if (!parsedAddressesComments.ok) return parsedAddressesComments;
  if (
    !isString(id) ||
    !isString(file) ||
    !isOneOf(Concerns, concern) ||
    !isOneOf(Roles, role)
  ) {
    return { ok: false, error: "Expected chunk id, file, concern, and role" };
  }
  if (changeGroupId !== undefined && !isString(changeGroupId)) {
    return { ok: false, error: "Expected chunk changeGroupId to be a string" };
  }
  if (summary !== undefined && !isString(summary)) {
    return { ok: false, error: "Expected chunk summary to be a string" };
  }
  const chunk: ParsedChunk = {
    id,
    file,
    concern,
    role,
    loc: loc.value,
    addedRanges: addedRanges.value,
    removedRanges: removedRanges.value,
    riskSurface: risks.value,
  };

  if (isString(changeGroupId)) chunk.changeGroupId = changeGroupId;
  if (riskNotes !== undefined) chunk.riskNotes = parsedRiskNotes.value;
  if (isString(summary)) chunk.summary = summary;
  if (addressesComments !== undefined) {
    chunk.addressesComments = parsedAddressesComments.value;
  }

  return { ok: true, value: chunk };
}

function parseChangeGroup(value: unknown): Result<ParsedChangeGroup> {
  if (!isRecord(value))
    return { ok: false, error: "Expected change group to be an object" };
  const id = value["id"];
  const title = value["title"];
  const summary = value["summary"];
  const dominantCategory = value["dominantCategory"];
  const uncertain = value["uncertain"];
  const secondaryCategories = categoryArray(value["secondaryCategories"]);
  if (!secondaryCategories.ok) return secondaryCategories;
  const uncertainBetween = categoryArray(value["uncertainBetween"]);
  if (!uncertainBetween.ok) return uncertainBetween;
  const coreChunkIds =
    value["coreChunkIds"] === undefined
      ? ({ ok: true, value: [] } satisfies Result<string[]>)
      : stringArray(value["coreChunkIds"]);
  if (!coreChunkIds.ok) return coreChunkIds;
  const supportingChunkIds =
    value["supportingChunkIds"] === undefined
      ? ({ ok: true, value: [] } satisfies Result<string[]>)
      : stringArray(value["supportingChunkIds"]);
  if (!supportingChunkIds.ok) return supportingChunkIds;
  if (
    !isString(title) ||
    !isString(summary) ||
    !isOneOf(Categories, dominantCategory) ||
    typeof uncertain !== "boolean"
  ) {
    return {
      ok: false,
      error:
        "Expected change group title, summary, dominant category, and uncertainty",
    };
  }
  if (id !== undefined && !isString(id)) {
    return { ok: false, error: "Expected change group id to be a string" };
  }
  const group: ParsedChangeGroup = {
    title,
    summary,
    dominantCategory,
    secondaryCategories: secondaryCategories.value,
    uncertain,
    uncertainBetween: uncertainBetween.value,
    coreChunkIds: coreChunkIds.value,
    supportingChunkIds: supportingChunkIds.value,
  };

  if (isString(id)) group.id = id;

  return { ok: true, value: group };
}

function parseReadingOrderStep(value: unknown): Result<ReadingOrderStep> {
  if (!isRecord(value))
    return { ok: false, error: "Expected reading-order step to be an object" };
  const groupId = value["groupId"];
  const why = value["why"];
  if (!isString(groupId) || !isString(why)) {
    return {
      ok: false,
      error: "Expected reading-order step groupId and why",
    };
  }
  return { ok: true, value: { groupId, why } };
}

/**
 * Mirrors the categorizer's warn-and-drop posture at the FE boundary: a
 * `readingOrder` must be an exact permutation of the parsed Brief's
 * `changeGroups` ids to survive. Artifacts can drift after the server
 * validated them, so the FE re-checks rather than trusting the field.
 */
function isReadingOrderPermutation(
  stepGroupIds: string[],
  groupIds: string[],
): boolean {
  if (stepGroupIds.length !== groupIds.length) return false;
  const knownIds = new Set(groupIds);
  const seen = new Set<string>();
  for (const id of stepGroupIds) {
    if (!knownIds.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * Parses an optional `readingOrder`, dropping it (with a console warning,
 * never a hard failure) when malformed or when it isn't a permutation of
 * `groupIds`. Full Brief only, Reading order is out of scope for Delta
 * Briefs, so callers must not wire this into Delta parsing.
 */
function parseReadingOrder(
  value: unknown,
  groupIds: string[],
  warnings: ParseWarnings | undefined,
): ReadingOrderStep[] | undefined {
  if (value === undefined) return undefined;
  const parsed = parseArray(value, parseReadingOrderStep, "readingOrder");
  if (!parsed.ok) {
    warnings?.warn(`parseBrief: dropping readingOrder — ${parsed.error}`);
    return undefined;
  }
  const stepGroupIds = parsed.value.map((step) => step.groupId);
  if (!isReadingOrderPermutation(stepGroupIds, groupIds)) {
    warnings?.warn(
      "parseBrief: dropping readingOrder — not a permutation of changeGroups ids",
    );
    return undefined;
  }
  return parsed.value;
}

function isSpecificity(value: unknown): value is Specificity {
  return value === "precise" || value === "broad" || value === "none";
}

/** Lenient: a malformed alignment parses to absent, never fails the check. */
function parseTicketAlignment(
  value: unknown,
  warnings: ParseWarnings | undefined,
): TicketAlignment | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    warnings?.warn("parseBrief: dropping alignment — not an object");
    return undefined;
  }
  const { read, goal, response } = value;
  if (
    !isOneOf(AlignmentReads, read) ||
    !isString(goal) ||
    !isString(response)
  ) {
    warnings?.warn("parseBrief: dropping alignment — malformed");
    return undefined;
  }
  return { read, goal, response };
}

/**
 * Lenient: a malformed or unknown-valued primary ticket parses to absent and
 * never fails the intent check.
 */
function parsePrimaryTicket(
  value: unknown,
  warnings: ParseWarnings | undefined,
): PrimaryTicket | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    warnings?.warn("parseBrief: dropping primaryTicket — not an object");
    return undefined;
  }
  const { key, url, tracker, foundIn, title, header, status, reason } = value;
  const textFieldsPresent =
    isString(key) && isString(url) && isString(title) && isString(header);
  const vocabulariesKnown =
    isOneOf(TicketTrackers, tracker) &&
    isOneOf(ReferenceLocations, foundIn) &&
    isOneOf(PrimaryTicketStatuses, status);
  // `reason` is "" on a read ticket, one of the unread codes otherwise.
  const reasonKnown = reason === "" || isOneOf(TicketUnreadReasons, reason);
  const wellFormed = textFieldsPresent && vocabulariesKnown && reasonKnown;
  if (!wellFormed) {
    warnings?.warn("parseBrief: dropping primaryTicket — malformed");
    return undefined;
  }
  return { key, url, tracker, foundIn, title, header, status, reason };
}

function parseIntentItem(value: unknown): Result<IntentItem> {
  if (!isRecord(value))
    return { ok: false, error: "Expected intent item to be an object" };
  const { intent, quote, sourceUrl } = value;
  if (!isString(intent) || !isString(quote) || !isString(sourceUrl)) {
    return {
      ok: false,
      error: "Expected intent item intent, quote, and sourceUrl",
    };
  }
  const groupIds = stringArray(value["groupIds"]);
  if (!groupIds.ok) return groupIds;
  // `acknowledged` is absent on older items and dead in four of the five
  // buckets, a missing or non-boolean value reads `false` rather than failing
  // the whole check. Only `true` is critical (it moves a deviation out of the
  // alarm register), so anything else is safely false.
  const acknowledged = value["acknowledged"] === true;
  return {
    ok: true,
    value: { intent, quote, sourceUrl, groupIds: groupIds.value, acknowledged },
  };
}

/**
 * Parses an optional `intentCheck`, dropping it to `undefined` (warn, never a
 * hard failure) when malformed, server-validated artifacts can still drift.
 * Full Brief only, never wired into `parseDeltaBrief`. groupIds are NOT
 * cross-validated here; `jumpToGroup` already ignores dangling ids.
 */
function parseIntentCheck(
  value: unknown,
  warnings: ParseWarnings | undefined,
): IntentCheck | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    warnings?.warn("parseBrief: dropping intentCheck — not an object");
    return undefined;
  }
  const { specificity, scopeNote } = value;
  if (!isSpecificity(specificity) || !isString(scopeNote)) {
    warnings?.warn(
      "parseBrief: dropping intentCheck — bad specificity or scopeNote",
    );
    return undefined;
  }
  const ticketUrls = stringArray(value["ticketUrls"]);
  // ABSENT on pre-title Briefs, read as empty, never drop the check; a
  // PRESENT-but-malformed array still drops it.
  const rawTitles = value["ticketTitles"];
  const ticketTitles: Result<string[]> =
    rawTitles === undefined ? { ok: true, value: [] } : stringArray(rawTitles);
  const accomplished = parseArray(
    value["accomplished"],
    parseIntentItem,
    "accomplished",
  );
  const statedButMissing = parseArray(
    value["statedButMissing"],
    parseIntentItem,
    "statedButMissing",
  );
  const doneButUnstated = parseArray(
    value["doneButUnstated"],
    parseIntentItem,
    "doneButUnstated",
  );
  // The alarm buckets are ABSENT on older Briefs, which must keep rendering
  // their bar rather than losing the whole intent check. So a missing array
  // reads as empty; a PRESENT-but-malformed one still drops the check.
  const deviations = parseOptionalIntentBucket(
    value["deviations"],
    "deviations",
  );
  const claimedButUnachieved = parseOptionalIntentBucket(
    value["claimedButUnachieved"],
    "claimedButUnachieved",
  );
  for (const parsed of [
    ticketUrls,
    ticketTitles,
    accomplished,
    statedButMissing,
    doneButUnstated,
    deviations,
    claimedButUnachieved,
  ]) {
    if (!parsed.ok) {
      warnings?.warn(`parseBrief: dropping intentCheck — ${parsed.error}`);
      return undefined;
    }
  }
  // The loop guarantees every result is ok; re-narrow for the type system.
  if (
    !ticketUrls.ok ||
    !ticketTitles.ok ||
    !accomplished.ok ||
    !statedButMissing.ok ||
    !doneButUnstated.ok ||
    !deviations.ok ||
    !claimedButUnachieved.ok
  ) {
    return undefined;
  }
  const primaryTicket = parsePrimaryTicket(value["primaryTicket"], warnings);
  const alignment = parseTicketAlignment(value["alignment"], warnings);
  const intentCheck: IntentCheck = {
    ticketUrls: ticketUrls.value,
    // Realigned to one title per URL ("" filling the gaps) so the renderer
    // can index the pair without its own bounds checks.
    ticketTitles: ticketUrls.value.map(
      (_, index) => ticketTitles.value[index] ?? "",
    ),
    specificity,
    scopeNote,
    // `acknowledged` is meaningful ONLY in `deviations`. Generation forces it
    // false elsewhere, but the file-backed demo path parses arbitrary local
    // JSON, so mirror that sweep here rather than trusting it.
    accomplished: unacknowledged(accomplished.value),
    statedButMissing: unacknowledged(statedButMissing.value),
    doneButUnstated: unacknowledged(doneButUnstated.value),
    deviations: deviations.value,
    claimedButUnachieved: unacknowledged(claimedButUnachieved.value),
  };
  if (primaryTicket !== undefined) intentCheck.primaryTicket = primaryTicket;
  if (alignment !== undefined) intentCheck.alignment = alignment;
  return intentCheck;
}

/** Dead-field sweep: `acknowledged` is only ever true in `deviations`. */
function unacknowledged(items: IntentItem[]): IntentItem[] {
  return items.map((item) =>
    item.acknowledged ? { ...item, acknowledged: false } : item,
  );
}

/**
 * An intent bucket that may be absent (the alarm pair on an older Brief),
 * `undefined` yields `[]`, anything else goes through the same per-item
 * parser as the required buckets.
 */
function parseOptionalIntentBucket(
  value: unknown,
  label: string,
): Result<IntentItem[]> {
  if (value === undefined) return { ok: true, value: [] };
  return parseArray(value, parseIntentItem, label);
}

function parseConcernRollup(value: unknown): Result<ConcernRollup> {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: "Expected concern rollup concern, added, and deleted",
    };
  }
  const concern = value["concern"];
  const added = value["added"];
  const deleted = value["deleted"];
  if (!isOneOf(Concerns, concern) || !isInteger(added) || !isInteger(deleted)) {
    return {
      ok: false,
      error: "Expected concern rollup concern, added, and deleted",
    };
  }
  return {
    ok: true,
    value: {
      concern,
      added,
      deleted,
    },
  };
}

function parseArray<T>(
  value: unknown,
  parser: (item: unknown) => Result<T>,
  label: string,
): Result<T[]> {
  if (!Array.isArray(value))
    return { ok: false, error: `Expected ${label} to be an array` };
  const parsed: T[] = [];
  for (const item of value) {
    const result = parser(item);
    if (!result.ok) return result;
    parsed.push(result.value);
  }
  return { ok: true, value: parsed };
}

// Lenient: legacy artifacts without these fields still parse (return undefined).
function parseCommitRange(value: unknown): CommitRange | undefined {
  if (!isRecord(value)) return undefined;
  const { base, head, commitCount } = value;
  if (!isString(base) || !isString(head) || !isInteger(commitCount))
    return undefined;
  return { base, head, commitCount };
}

/** Anchor stamp: known states only; malformed/unknown → absent
 * (warned, a drift here means the stored-brief contract moved). */
function parseAnchor(
  value: unknown,
  warnings?: ParseWarnings,
): BriefAnchor | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    warnings?.warn("brief anchor stamp malformed — dropped");
    return undefined;
  }
  const state = value["state"];
  if (state !== "anchored" && state !== "fresh-restart" && state !== "none") {
    warnings?.warn("brief anchor stamp has an unknown state — dropped");
    return undefined;
  }
  const reason = value["reason"];
  const anchor: BriefAnchor = { state };

  if (isString(reason)) anchor.reason = reason;

  return anchor;
}

function parseGeneration(value: unknown): Generation | undefined {
  if (!isRecord(value)) return undefined;
  const { provider, model, effort } = value;
  if (!isString(provider) || !isString(model)) return undefined;
  return { provider, model, effort: isString(effort) ? effort : null };
}

/** Defensive: keep string entries only; absent/invalid → undefined. */
function parseGenerationWarnings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(isString);
  return entries.length > 0 ? entries : undefined;
}

/**
 * Length-violation stamp: pipeline-assigned diagnostics, the
 * UI only needs "any present" for the muted line, so malformed entries are
 * dropped silently and an empty result reads as absent.
 */
function parseLengthViolations(value: unknown): LengthViolation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.flatMap((entry): LengthViolation[] => {
    if (!isRecord(entry)) return [];
    const { surface, field, actual, cap } = entry;
    if (
      !isString(surface) ||
      !isString(field) ||
      !isInteger(actual) ||
      !isInteger(cap)
    ) {
      return [];
    }
    return [{ surface, field, actual, cap }];
  });
  return entries.length > 0 ? entries : undefined;
}

/**
 * The one log level `parseBrief` emits: a dropped optional section is degraded
 * output, never operator-actionable failure. INJECTED because this module is
 * shared client/server, the server caller passes the process logger; the
 * client passes nothing and the drops stay silent.
 */
export interface ParseWarnings {
  warn(msg: string): void;
}

export function parseBrief(
  value: unknown,
  warnings?: ParseWarnings,
): Result<Brief> {
  if (!isRecord(value))
    return { ok: false, error: "Expected brief to be an object" };
  const summary = value["summary"];
  const pr = parsePrRef(value["pr"]);
  if (!pr.ok) return pr;
  const changeGroups = parseArray(
    value["changeGroups"],
    parseChangeGroup,
    "changeGroups",
  );
  if (!changeGroups.ok) return changeGroups;
  const chunks = parseArray(value["chunks"], parseChunk, "chunks");
  if (!chunks.ok) return chunks;
  const concernView = parseArray(
    value["concernView"],
    parseConcernRollup,
    "concernView",
  );
  if (!concernView.ok) return concernView;
  if (!isString(summary)) return { ok: false, error: "Expected brief summary" };
  const normalized = normalizeGroupsAndChunks(changeGroups.value, chunks.value);
  if (!normalized.ok) return normalized;
  const index = value["index"];
  const commitRange = parseCommitRange(value["commitRange"]);
  const generation = parseGeneration(value["generation"]);
  const anchor = parseAnchor(value["anchor"], warnings);
  const generationWarnings = parseGenerationWarnings(
    value["generationWarnings"],
  );
  const lengthViolations = parseLengthViolations(value["lengthViolations"]);
  const readingOrder = parseReadingOrder(
    value["readingOrder"],
    normalized.value.changeGroups.map((group) => group.id),
    warnings,
  );
  const intentCheck = parseIntentCheck(value["intentCheck"], warnings);
  const unattributed = parseUnattributed(value["unattributed"], warnings);
  const diffTotals = parseLoc(value["diffTotals"]);
  const brief: Brief = {
    artifactKind: "brief",
    pr: pr.value,
    summary,
    changeGroups: normalized.value.changeGroups,
    chunks: normalized.value.chunks,
    concernView: concernView.value,
  };

  if (unattributed !== undefined) brief.unattributed = unattributed;
  if (diffTotals.ok) brief.diffTotals = diffTotals.value;
  if (isInteger(index)) brief.index = index;
  if (commitRange) brief.commitRange = commitRange;
  if (generation) brief.generation = generation;
  if (anchor) brief.anchor = anchor;
  if (generationWarnings) brief.generationWarnings = generationWarnings;
  if (lengthViolations) brief.lengthViolations = lengthViolations;
  if (readingOrder) brief.readingOrder = readingOrder;
  if (intentCheck) brief.intentCheck = intentCheck;

  return { ok: true, value: brief };
}

export function parseDeltaBrief(value: unknown): Result<Brief> {
  if (!isRecord(value))
    return { ok: false, error: "Expected delta brief to be an object" };
  const pr = parsePrRef(value["pr"]);
  if (!pr.ok) return pr;
  const baselineSha = value["baselineSha"];
  const headSha = value["headSha"];
  const summary = value["summary"];
  const commentsAddressed = value["commentsAddressed"];
  const reviewComments = value["reviewComments"];
  const wholePrImpact = value["wholePrImpact"];
  const changeGroups = parseArray(
    value["changedGroups"],
    parseChangeGroup,
    "changedGroups",
  );
  if (!changeGroups.ok) return changeGroups;
  const chunks = parseArray(value["chunks"], parseChunk, "chunks");
  if (!chunks.ok) return chunks;
  if (
    !isString(baselineSha) ||
    !isString(headSha) ||
    !isString(summary) ||
    !isString(commentsAddressed) ||
    !isString(wholePrImpact)
  ) {
    return {
      ok: false,
      error:
        "Expected delta baseline, head, summary, commentsAddressed, and wholePrImpact",
    };
  }
  const parsedReviewComments =
    reviewComments === undefined
      ? ({ ok: true, value: [] } satisfies Result<AddressedReviewComment[]>)
      : parseArray(
          reviewComments,
          parseAddressedReviewComment,
          "reviewComments",
        );
  if (!parsedReviewComments.ok) return parsedReviewComments;
  for (const chunk of chunks.value) {
    if (!chunk.summary || !chunk.addressesComments) {
      return {
        ok: false,
        error: "Expected delta chunk summary and addressesComments",
      };
    }
  }
  const normalized = normalizeGroupsAndChunks(changeGroups.value, chunks.value);
  if (!normalized.ok) return normalized;
  const baselineIndex = value["baselineIndex"];
  const headIndex = value["headIndex"];
  const generation = parseGeneration(value["generation"]);
  const generationWarnings = parseGenerationWarnings(
    value["generationWarnings"],
  );
  const lengthViolations = parseLengthViolations(value["lengthViolations"]);
  const delta: Brief = {
    artifactKind: "delta",
    pr: pr.value,
    baselineSha,
    headSha,
    summary,
    commentsAddressed,
    changeGroups: normalized.value.changeGroups,
    chunks: normalized.value.chunks,
    concernView: buildConcernView(normalized.value.chunks),
    wholePrImpact,
  };

  if (isNullableInteger(baselineIndex)) delta.baselineIndex = baselineIndex;
  if (isNullableInteger(headIndex)) delta.headIndex = headIndex;
  if (generation) delta.generation = generation;
  if (generationWarnings) delta.generationWarnings = generationWarnings;
  if (lengthViolations) delta.lengthViolations = lengthViolations;
  if (reviewComments !== undefined) {
    delta.reviewComments = parsedReviewComments.value;
  }

  return { ok: true, value: delta };
}

function normalizeGroupsAndChunks(
  groups: ParsedChangeGroup[],
  chunks: ParsedChunk[],
): Result<{ changeGroups: ChangeGroup[]; chunks: BriefChunk[] }> {
  const changeGroups = groups.map(
    (
      {
        coreChunkIds: _coreChunkIds,
        supportingChunkIds: _supportingChunkIds,
        ...group
      },
      index,
    ) => ({
      ...group,
      id: group.id ?? `g${index + 1}`,
    }),
  );
  const groupIds = new Set(changeGroups.map((group) => group.id));
  const legacyMembership = new Map<string, string>();

  groups.forEach((group, index) => {
    const groupId = group.id ?? `g${index + 1}`;
    for (const chunkId of [
      ...group.coreChunkIds,
      ...group.supportingChunkIds,
    ]) {
      if (legacyMembership.has(chunkId)) {
        return;
      }
      legacyMembership.set(chunkId, groupId);
    }
  });

  const normalizedChunks: BriefChunk[] = [];
  for (const chunk of chunks) {
    const changeGroupId = chunk.changeGroupId ?? legacyMembership.get(chunk.id);
    if (!changeGroupId) {
      return {
        ok: false,
        error: `Expected chunk ${chunk.id} to have a changeGroupId`,
      };
    }
    if (!groupIds.has(changeGroupId)) {
      return {
        ok: false,
        error: `Chunk ${chunk.id} references unknown change group ${changeGroupId}`,
      };
    }
    normalizedChunks.push({ ...chunk, changeGroupId });
  }

  return { ok: true, value: { changeGroups, chunks: normalizedChunks } };
}

/** Vocabulary-order rollup, matches the pipeline's derived concernView. */
function buildConcernView(chunks: BriefChunk[]): ConcernRollup[] {
  const byConcern = new Map<Concern, { added: number; deleted: number }>();
  for (const chunk of chunks) {
    const current = byConcern.get(chunk.concern) ?? { added: 0, deleted: 0 };
    current.added += chunk.loc.added;
    current.deleted += chunk.loc.deleted;
    byConcern.set(chunk.concern, current);
  }
  return Object.values(Concerns).flatMap((concern) => {
    const loc = byConcern.get(concern);
    if (loc === undefined) return [];
    return [{ concern, added: loc.added, deleted: loc.deleted }];
  });
}
