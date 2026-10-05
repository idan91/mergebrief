import type { z } from "zod/v4";
import { BriefSchema, PrRefSchema } from "../../types";
import {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type BriefSectionSchemas,
  type PrSectionSchemas,
  type ReadingOrderRead,
  type SectionsRead,
  type StoredBrief,
} from "../types";
import { isRecord, parseStored } from "../utils";

const BRIEF_SECTIONS: BriefSectionSchemas = {
  index: BriefSchema.shape.index,
  commitRange: BriefSchema.shape.commitRange,
  generation: BriefSchema.shape.generation,
  anchor: BriefSchema.shape.anchor,
  anchoring: BriefSchema.shape.anchoring,
  generationWarnings: BriefSchema.shape.generationWarnings,
  lengthViolations: BriefSchema.shape.lengthViolations,
  unattributed: BriefSchema.shape.unattributed,
  diffTotals: BriefSchema.shape.diffTotals,
  readingOrder: BriefSchema.shape.readingOrder,
  intentCheck: BriefSchema.shape.intentCheck,
};

const PR_SECTIONS: PrSectionSchemas = {
  state: PrRefSchema.shape.state,
  draft: PrRefSchema.shape.draft,
  merged: PrRefSchema.shape.merged,
  headRef: PrRefSchema.shape.headRef,
  baseRef: PrRefSchema.shape.baseRef,
  stack: PrRefSchema.shape.stack,
};

/** A broken section can report one issue per element. */
const MAX_SECTION_MESSAGES = 5;
const NOT_A_PERMUTATION = "Not a permutation of the change group ids";

function dropInvalidSections(
  owner: Record<string, unknown>,
  sections: Record<string, z.ZodType>,
  pathPrefix: string,
): SectionsRead {
  const dropped: ArtifactIssue[] = [];
  const invalidKeys = new Set<string>();

  for (const [key, schema] of Object.entries(sections)) {
    const parsed = parseStored(schema, owner[key]);
    const isAbsentOrValid = !Object.hasOwn(owner, key) || parsed.ok;
    if (isAbsentOrValid) {
      continue;
    }

    invalidKeys.add(key);
    const messages = parsed.error
      .slice(0, MAX_SECTION_MESSAGES)
      .map((issue) => issue.message);
    dropped.push({
      code: ArtifactIssueCodes.DROPPED_SECTION,
      path: `${pathPrefix}${key}`,
      message: messages.join("; "),
    });
  }

  const keptEntries = Object.entries(owner).filter(
    ([key]) => !invalidKeys.has(key),
  );
  return { body: Object.fromEntries(keptEntries), dropped };
}

/** An absent section is not an issue; a present, invalid one is removed. */
export function dropInvalidBriefSections(
  body: Record<string, unknown>,
): SectionsRead {
  const top = dropInvalidSections(body, BRIEF_SECTIONS, "");
  const pr = top.body["pr"];
  const prIsObject = isRecord(pr);
  if (!prIsObject) {
    return top;
  }

  const inPr = dropInvalidSections(pr, PR_SECTIONS, "pr.");
  return {
    body: { ...top.body, pr: inPr.body },
    dropped: [...top.dropped, ...inPr.dropped],
  };
}

function isGroupPermutation(
  stepGroupIds: readonly string[],
  groupIds: readonly string[],
): boolean {
  const knownIds = new Set(groupIds);
  const distinctSteps = new Set(stepGroupIds);
  const visitsOncePerGroup =
    stepGroupIds.length === groupIds.length &&
    distinctSteps.size === stepGroupIds.length;

  const visitsOnlyKnownGroups = stepGroupIds.every((id) => knownIds.has(id));
  const isPermutation = visitsOncePerGroup && visitsOnlyKnownGroups;
  return isPermutation;
}

/** Runs after the group ids are final, since the order is checked against them. */
export function dropUnorderedReadingOrder(
  brief: StoredBrief,
): ReadingOrderRead {
  if (brief.readingOrder === undefined) {
    return { brief, dropped: [] };
  }

  const stepGroupIds = brief.readingOrder.map((step) => step.groupId);
  const groupIds = brief.changeGroups.map((group) => group.id);
  const isOrdered = isGroupPermutation(stepGroupIds, groupIds);
  if (isOrdered) {
    return { brief, dropped: [] };
  }

  const { readingOrder: _unordered, ...kept } = brief;
  const issue: ArtifactIssue = {
    code: ArtifactIssueCodes.DROPPED_SECTION,
    path: "readingOrder",
    message: NOT_A_PERMUTATION,
  };
  return { brief: kept, dropped: [issue] };
}
