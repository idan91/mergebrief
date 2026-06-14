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
  type DeltaBrief,
  type LineRange,
  type MovedCommentAnchor,
  type PrRef,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
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

function parseChunk(value: unknown): Result<BriefChunk> {
  if (!isRecord(value)) return { ok: false, error: "Expected chunk to be an object" };
  const id = value["id"];
  const file = value["file"];
  const concern = value["concern"];
  const role = value["role"];
  const loc = parseLoc(value["loc"]);
  if (!loc.ok) return loc;
  const addedRanges = parseArray(value["addedRanges"], parseLineRange, "addedRanges");
  if (!addedRanges.ok) return addedRanges;
  const removedRanges = parseArray(value["removedRanges"], parseLineRange, "removedRanges");
  if (!removedRanges.ok) return removedRanges;
  const risks = riskSurfaceArray(value["riskSurface"]);
  if (!risks.ok) return risks;
  if (!isString(id) || !isString(file) || !oneOf(Concerns, concern) || !oneOf(Roles, role)) {
    return { ok: false, error: "Expected chunk id, file, concern, and role" };
  }
  return {
    ok: true,
    value: {
      id,
      file,
      concern: concern as Concern,
      role: role as Role,
      loc: loc.value,
      addedRanges: addedRanges.value,
      removedRanges: removedRanges.value,
      riskSurface: risks.value,
    },
  };
}

function parseChangeGroup(value: unknown): Result<ChangeGroup> {
  if (!isRecord(value)) return { ok: false, error: "Expected change group to be an object" };
  const title = value["title"];
  const summary = value["summary"];
  const dominantCategory = value["dominantCategory"];
  const uncertain = value["uncertain"];
  const secondaryCategories = categoryArray(value["secondaryCategories"]);
  if (!secondaryCategories.ok) return secondaryCategories;
  const uncertainBetween = categoryArray(value["uncertainBetween"]);
  if (!uncertainBetween.ok) return uncertainBetween;
  const carrierChunkIds = stringArray(value["carrierChunkIds"]);
  if (!carrierChunkIds.ok) return carrierChunkIds;
  const supportingChunkIds = stringArray(value["supportingChunkIds"]);
  if (!supportingChunkIds.ok) return supportingChunkIds;
  if (!isString(title) || !isString(summary) || !oneOf(Categories, dominantCategory) || typeof uncertain !== "boolean") {
    return { ok: false, error: "Expected change group title, summary, dominant category, and uncertainty" };
  }
  return {
    ok: true,
    value: {
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

function parseMovedCommentAnchor(value: unknown): Result<MovedCommentAnchor> {
  if (!isRecord(value)) return { ok: false, error: "Expected moved comment anchor to be an object" };
  const commentId = value["commentId"];
  const from = value["from"];
  const to = value["to"];
  if (!isString(commentId) || !isString(from) || !isString(to)) {
    return { ok: false, error: "Expected moved comment anchor commentId, from, and to" };
  }
  return { ok: true, value: { commentId, from, to } };
}

export function parseDeltaBrief(value: unknown): Result<DeltaBrief> {
  if (!isRecord(value)) return { ok: false, error: "Expected delta brief to be an object" };
  const previousSha = value["previousSha"];
  const currentSha = value["currentSha"];
  const summary = value["summary"];
  const newChunkIds = stringArray(value["newChunkIds"]);
  if (!newChunkIds.ok) return newChunkIds;
  const changedChunkIds = stringArray(value["changedChunkIds"]);
  if (!changedChunkIds.ok) return changedChunkIds;
  const reopenedRiskFlagIds = stringArray(value["reopenedRiskFlagIds"]);
  if (!reopenedRiskFlagIds.ok) return reopenedRiskFlagIds;
  const movedCommentAnchors = parseArray(value["movedCommentAnchors"], parseMovedCommentAnchor, "movedCommentAnchors");
  if (!movedCommentAnchors.ok) return movedCommentAnchors;
  const orphanedCommentIds = stringArray(value["orphanedCommentIds"]);
  if (!orphanedCommentIds.ok) return orphanedCommentIds;
  const stillResolvedRiskFlagIds = stringArray(value["stillResolvedRiskFlagIds"]);
  if (!stillResolvedRiskFlagIds.ok) return stillResolvedRiskFlagIds;
  if (!isString(previousSha) || !isString(currentSha) || !isString(summary)) {
    return { ok: false, error: "Expected delta brief previousSha, currentSha, and summary" };
  }
  return {
    ok: true,
    value: {
      previousSha,
      currentSha,
      summary,
      newChunkIds: newChunkIds.value,
      changedChunkIds: changedChunkIds.value,
      reopenedRiskFlagIds: reopenedRiskFlagIds.value,
      movedCommentAnchors: movedCommentAnchors.value,
      orphanedCommentIds: orphanedCommentIds.value,
      stillResolvedRiskFlagIds: stillResolvedRiskFlagIds.value,
    },
  };
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
  return {
    ok: true,
    value: {
      pr: pr.value,
      summary,
      changeGroups: changeGroups.value,
      chunks: chunks.value,
      concernView: concernView.value,
    },
  };
}
