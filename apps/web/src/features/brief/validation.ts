import {
  Categories,
  Concerns,
  RiskSurfaceAttributes,
  Roles,
  type Brief,
  type BriefChunk,
  type Category,
  type ChangeGroup,
  type ChunkLoc,
  type Concern,
  type ConcernRollup,
  type LineRange,
  type PrRef,
  type AddressedReviewComment,
  type RiskSurfaceAttribute,
  type Role,
  type ValueOf,
} from "./types";

interface ValidationResult<T> {
  ok: true;
  value: T;
}

interface ValidationError {
  ok: false;
  error: string;
}

type Result<T> = ValidationResult<T> | ValidationError;

interface ParsedChangeGroup {
  id?: string;
  title: string;
  summary: string;
  dominantCategory: Category;
  secondaryCategories: Category[];
  uncertain: boolean;
  uncertainBetween: Category[];
  carrierChunkIds: string[];
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

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function oneOf<T extends Record<string, string>>(values: T, value: unknown): value is ValueOf<T> {
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
  if (!parsed.value.every((item): item is Category => oneOf(Categories, item))) {
    return { ok: false, error: "Expected an array of known categories" };
  }
  return { ok: true, value: parsed.value };
}

function riskSurfaceArray(value: unknown): Result<RiskSurfaceAttribute[]> {
  const parsed = stringArray(value);
  if (!parsed.ok) return parsed;
  if (!parsed.value.every((item): item is RiskSurfaceAttribute => oneOf(RiskSurfaceAttributes, item))) {
    return { ok: false, error: "Expected an array of known risk-surface attributes" };
  }
  return { ok: true, value: parsed.value };
}

function parsePrRef(value: unknown): Result<PrRef> {
  if (!isRecord(value)) return { ok: false, error: "Expected pr to be an object" };
  const repo = value["repo"];
  const number = value["number"];
  const title = value["title"];
  const url = value["url"];
  const sha = value["sha"];
  const description = value["description"];
  if (!isString(repo) || !isInteger(number) || !isString(title) || !isString(url) || !isString(sha) || !isString(description)) {
    return { ok: false, error: "Expected pr repo, number, title, url, sha, and description" };
  }
  return {
    ok: true,
    value: {
      repo,
      number,
      title,
      url,
      sha,
      description,
    },
  };
}

export function parseAddressedReviewComment(value: unknown): Result<AddressedReviewComment> {
  if (!isRecord(value)) return { ok: false, error: "Expected review comment to be an object" };
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
    return { ok: false, error: "Expected review comment id, file, startLine, line, originalStartLine, originalLine, author, body, inReplyToId, and outdated" };
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

export function parseAddressedReviewComments(value: unknown): Result<AddressedReviewComment[]> {
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

function parseChunk(value: unknown): Result<ParsedChunk> {
  if (!isRecord(value)) return { ok: false, error: "Expected chunk to be an object" };
  const id = value["id"];
  const changeGroupId = value["changeGroupId"];
  const file = value["file"];
  const concern = value["concern"];
  const role = value["role"];
  const summary = value["summary"];
  const addressesComments = value["addressesComments"];
  const loc = parseLoc(value["loc"]);
  if (!loc.ok) return loc;
  const addedRanges = parseArray(value["addedRanges"], parseLineRange, "addedRanges");
  if (!addedRanges.ok) return addedRanges;
  const removedRanges = parseArray(value["removedRanges"], parseLineRange, "removedRanges");
  if (!removedRanges.ok) return removedRanges;
  const risks = riskSurfaceArray(value["riskSurface"]);
  if (!risks.ok) return risks;
  const parsedAddressesComments = addressesComments === undefined ? { ok: true, value: [] } satisfies Result<string[]> : stringArray(addressesComments);
  if (!parsedAddressesComments.ok) return parsedAddressesComments;
  if (!isString(id) || !isString(file) || !oneOf(Concerns, concern) || !oneOf(Roles, role)) {
    return { ok: false, error: "Expected chunk id, file, concern, and role" };
  }
  if (changeGroupId !== undefined && !isString(changeGroupId)) {
    return { ok: false, error: "Expected chunk changeGroupId to be a string" };
  }
  if (summary !== undefined && !isString(summary)) {
    return { ok: false, error: "Expected chunk summary to be a string" };
  }
  return {
    ok: true,
    value: {
      id,
      ...(isString(changeGroupId) ? { changeGroupId } : {}),
      file,
      concern: concern as Concern,
      role: role as Role,
      loc: loc.value,
      addedRanges: addedRanges.value,
      removedRanges: removedRanges.value,
      riskSurface: risks.value,
      ...(isString(summary) ? { summary } : {}),
      ...(addressesComments !== undefined ? { addressesComments: parsedAddressesComments.value } : {}),
    },
  };
}

function parseChangeGroup(value: unknown): Result<ParsedChangeGroup> {
  if (!isRecord(value)) return { ok: false, error: "Expected change group to be an object" };
  const id = value["id"];
  const title = value["title"];
  const summary = value["summary"];
  const dominantCategory = value["dominantCategory"];
  const uncertain = value["uncertain"];
  const secondaryCategories = categoryArray(value["secondaryCategories"]);
  if (!secondaryCategories.ok) return secondaryCategories;
  const uncertainBetween = categoryArray(value["uncertainBetween"]);
  if (!uncertainBetween.ok) return uncertainBetween;
  const carrierChunkIds = value["carrierChunkIds"] === undefined ? { ok: true, value: [] } satisfies Result<string[]> : stringArray(value["carrierChunkIds"]);
  if (!carrierChunkIds.ok) return carrierChunkIds;
  const supportingChunkIds = value["supportingChunkIds"] === undefined ? { ok: true, value: [] } satisfies Result<string[]> : stringArray(value["supportingChunkIds"]);
  if (!supportingChunkIds.ok) return supportingChunkIds;
  if (!isString(title) || !isString(summary) || !oneOf(Categories, dominantCategory) || typeof uncertain !== "boolean") {
    return { ok: false, error: "Expected change group title, summary, dominant category, and uncertainty" };
  }
  if (id !== undefined && !isString(id)) {
    return { ok: false, error: "Expected change group id to be a string" };
  }
  return {
    ok: true,
    value: {
      ...(isString(id) ? { id } : {}),
      title,
      summary,
      dominantCategory: dominantCategory as Category,
      secondaryCategories: secondaryCategories.value,
      uncertain,
      uncertainBetween: uncertainBetween.value,
      carrierChunkIds: carrierChunkIds.value,
      supportingChunkIds: supportingChunkIds.value,
    },
  };
}

function parseConcernRollup(value: unknown): Result<ConcernRollup> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected concern rollup concern, added, and deleted" };
  }
  const concern = value["concern"];
  const added = value["added"];
  const deleted = value["deleted"];
  if (!oneOf(Concerns, concern) || !isInteger(added) || !isInteger(deleted)) {
    return { ok: false, error: "Expected concern rollup concern, added, and deleted" };
  }
  return {
    ok: true,
    value: {
      concern: concern as Concern,
      added,
      deleted,
    },
  };
}

function parseArray<T>(value: unknown, parser: (item: unknown) => Result<T>, label: string): Result<T[]> {
  if (!Array.isArray(value)) return { ok: false, error: `Expected ${label} to be an array` };
  const parsed: T[] = [];
  for (const item of value) {
    const result = parser(item);
    if (!result.ok) return result;
    parsed.push(result.value);
  }
  return { ok: true, value: parsed };
}

export function parseBrief(value: unknown): Result<Brief> {
  if (!isRecord(value)) return { ok: false, error: "Expected brief to be an object" };
  const summary = value["summary"];
  const pr = parsePrRef(value["pr"]);
  if (!pr.ok) return pr;
  const changeGroups = parseArray(value["changeGroups"], parseChangeGroup, "changeGroups");
  if (!changeGroups.ok) return changeGroups;
  const chunks = parseArray(value["chunks"], parseChunk, "chunks");
  if (!chunks.ok) return chunks;
  const concernView = parseArray(value["concernView"], parseConcernRollup, "concernView");
  if (!concernView.ok) return concernView;
  if (!isString(summary)) return { ok: false, error: "Expected brief summary" };
  const normalized = normalizeGroupsAndChunks(changeGroups.value, chunks.value);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    value: {
      artifactKind: "brief",
      pr: pr.value,
      summary,
      changeGroups: normalized.value.changeGroups,
      chunks: normalized.value.chunks,
      concernView: concernView.value,
    },
  };
}

export function parseDeltaBrief(value: unknown): Result<Brief> {
  if (!isRecord(value)) return { ok: false, error: "Expected delta brief to be an object" };
  const pr = parsePrRef(value["pr"]);
  if (!pr.ok) return pr;
  const baselineSha = value["baselineSha"];
  const headSha = value["headSha"];
  const summary = value["summary"];
  const commentsAddressed = value["commentsAddressed"];
  const reviewComments = value["reviewComments"];
  const wholePrImpact = value["wholePrImpact"];
  const changeGroups = parseArray(value["changedGroups"], parseChangeGroup, "changedGroups");
  if (!changeGroups.ok) return changeGroups;
  const chunks = parseArray(value["chunks"], parseChunk, "chunks");
  if (!chunks.ok) return chunks;
  if (!isString(baselineSha) || !isString(headSha) || !isString(summary) || !isString(commentsAddressed) || !isString(wholePrImpact)) {
    return { ok: false, error: "Expected delta baseline, head, summary, commentsAddressed, and wholePrImpact" };
  }
  const parsedReviewComments = reviewComments === undefined ? { ok: true, value: [] } satisfies Result<AddressedReviewComment[]> : parseArray(reviewComments, parseAddressedReviewComment, "reviewComments");
  if (!parsedReviewComments.ok) return parsedReviewComments;
  for (const chunk of chunks.value) {
    if (!chunk.summary || !chunk.addressesComments) {
      return { ok: false, error: "Expected delta chunk summary and addressesComments" };
    }
  }
  const normalized = normalizeGroupsAndChunks(changeGroups.value, chunks.value);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    value: {
      artifactKind: "delta",
      pr: pr.value,
      baselineSha,
      headSha,
      summary,
      commentsAddressed,
      ...(reviewComments !== undefined ? { reviewComments: parsedReviewComments.value } : {}),
      changeGroups: normalized.value.changeGroups,
      chunks: normalized.value.chunks,
      concernView: buildConcernView(normalized.value.chunks),
      wholePrImpact,
    },
  };
}

function normalizeGroupsAndChunks(groups: ParsedChangeGroup[], chunks: ParsedChunk[]): Result<{ changeGroups: ChangeGroup[]; chunks: BriefChunk[] }> {
  const changeGroups = groups.map(({ carrierChunkIds: _carrierChunkIds, supportingChunkIds: _supportingChunkIds, ...group }, index) => ({
    ...group,
    id: group.id ?? `g${index + 1}`,
  }));
  const groupIds = new Set(changeGroups.map((group) => group.id));
  const legacyMembership = new Map<string, string>();

  groups.forEach((group, index) => {
    const groupId = group.id ?? `g${index + 1}`;
    for (const chunkId of [...group.carrierChunkIds, ...group.supportingChunkIds]) {
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
      return { ok: false, error: `Expected chunk ${chunk.id} to have a changeGroupId` };
    }
    if (!groupIds.has(changeGroupId)) {
      return { ok: false, error: `Chunk ${chunk.id} references unknown change group ${changeGroupId}` };
    }
    normalizedChunks.push({ ...chunk, changeGroupId });
  }

  return { ok: true, value: { changeGroups, chunks: normalizedChunks } };
}

function buildConcernView(chunks: BriefChunk[]): ConcernRollup[] {
  const byConcern = new Map<Concern, { added: number; deleted: number }>();
  for (const chunk of chunks) {
    const current = byConcern.get(chunk.concern) ?? { added: 0, deleted: 0 };
    current.added += chunk.loc.added;
    current.deleted += chunk.loc.deleted;
    byConcern.set(chunk.concern, current);
  }
  return [...byConcern.entries()].map(([concern, loc]) => ({ concern, added: loc.added, deleted: loc.deleted }));
}
