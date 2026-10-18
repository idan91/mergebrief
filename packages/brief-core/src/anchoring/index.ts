// Pure anchored planning and stitching shared by the worker and revision-pair evals.
// Carry frozen groups verbatim and remap ids by descent without model calls.
import type { Mutable } from "types/utils";
import { assignGroupIds } from "../diff/descent";
import { splitDiffByFile } from "../diff/file-diff";
import {
  parseHunkSpans,
  remapThroughPatch,
  RemapOutcomes,
  type Hop,
  type HunkSpan,
} from "../diff/remap";
import { parseChangedRanges } from "../diff/revchanges";
import {
  GroupVerdicts,
  partitionGroups,
  type CompareFileEntry,
} from "../diff/touched";
import type { Brief, IntentCheck, IntentItem } from "../types";
import type {
  AnchorPlan,
  AnchorPlanArgs,
  ChangeGroup,
  Chunk,
  CompareFile,
  CompareFiles,
  FrozenCarry,
  ReLookEntry,
  StitchArgs,
  StitchResult,
} from "./types";

/** Files per previous group, from its chunks (order-stable, deduped). */
function getGroupFiles(brief: Brief, groupId: string): string[] {
  const files: string[] = [];
  for (const chunk of brief.chunks) {
    if (chunk.changeGroupId === groupId && !files.includes(chunk.file)) {
      files.push(chunk.file);
    }
  }
  return files;
}

function allReLook(
  brief: Brief,
  reason: string,
  chainGroupIds: readonly string[] = [],
): AnchorPlan {
  return {
    frozen: [],
    frozenFiles: new Set(),
    reLook: brief.changeGroups.map((group) => ({
      id: group.id,
      files: getGroupFiles(brief, group.id),
      reason,
    })),
    previousGroupIds: reserveIds(brief, chainGroupIds),
  };
}

/** Previous-brief ids ∪ the chain's, deduped, previous first. */
function reserveIds(brief: Brief, chainGroupIds: readonly string[]): string[] {
  return [
    ...new Set([
      ...brief.changeGroups.map((group) => group.id),
      ...chainGroupIds,
    ]),
  ];
}

/**
 * Zero-hunk entries win path collisions: anchors refer to the pre-push tree.
 * Renamed-away paths and patch/compare disagreements must demote rather than bind new code.
 */
function buildHop(
  compareFiles: CompareFiles,
  patches: ReadonlyMap<string, string>,
): Hop {
  const byPath = new Map<string, readonly HunkSpan[]>();
  for (const file of compareFiles.files) {
    byPath.set(file.filename, parseHunkSpans(patches.get(file.filename) ?? ""));
  }
  // A path the raw diff touched but the compare list omits is a disagreement
  // between two views of the same push, not evidence that it is untouched.
  for (const file of patches.keys()) {
    if (!byPath.has(file)) {
      byPath.set(file, []);
    }
  }
  for (const file of compareFiles.files) {
    if (file.previousFilename !== undefined) {
      byPath.set(file.previousFilename, []);
    }
  }
  return [...byPath].map(([file, hunks]) => ({ file, hunks }));
}

/**
 * Rebases, missing comparisons, shared files and ambiguous remaps require re-look.
 * Two carried groups cannot both own the same file.
 */
export function planAnchoredGeneration(args: AnchorPlanArgs): AnchorPlan {
  const { previousBrief, incrementalDiff, compareFiles, baseShaMoved } = args;
  const chainGroupIds = args.chainGroupIds ?? [];
  if (baseShaMoved) {
    return allReLook(
      previousBrief,
      "base SHA moved (rebase/base-advance) — three-dot span data untrusted",
      chainGroupIds,
    );
  }
  if (incrementalDiff === undefined) {
    return allReLook(
      previousBrief,
      "incremental span diff unavailable",
      chainGroupIds,
    );
  }
  if (compareFiles === undefined) {
    return allReLook(
      previousBrief,
      "compare file metadata unavailable",
      chainGroupIds,
    );
  }
  if (compareFiles.status !== "ahead") {
    // A same-base force-push (amend/squash/drop) never moves the base SHA but
    // shows 'diverged' here, and then the three-dot span diffs from the
    // divergence point, not prevHead, so "absent from the span" proves
    // nothing. Only a fast-forward span is trustworthy evidence.
    return allReLook(
      previousBrief,
      `compare span status '${compareFiles.status ?? "unknown"}' — not a fast-forward push`,
      chainGroupIds,
    );
  }

  const groupFiles = previousBrief.changeGroups.map((group) => ({
    id: group.id,
    files: getGroupFiles(previousBrief, group.id),
  }));

  // Coverage exclusivity: a file owned by two previous groups can only be
  // carried once, force every co-owner to re-look and let the model (and
  // descent) re-partition that file.
  const ownersByFile = new Map<string, number>();
  for (const group of groupFiles) {
    for (const file of group.files) {
      ownersByFile.set(file, (ownersByFile.get(file) ?? 0) + 1);
    }
  }
  const sharedForced = new Set<string>();
  for (const group of groupFiles) {
    if (group.files.some((file) => (ownersByFile.get(file) ?? 0) > 1)) {
      sharedForced.add(group.id);
    }
  }

  const verdicts = partitionGroups({
    previousGroups: groupFiles,
    incrementalFiles: parseChangedRanges(incrementalDiff),
    compareFiles: compareFiles.files.map(shapeCompareFileEntry),
    compareComplete: compareFiles.complete,
  });

  const patches = new Map(
    splitDiffByFile(incrementalDiff).map((entry) => [entry.file, entry.patch]),
  );

  const frozen: FrozenCarry[] = [];
  const frozenFiles = new Set<string>();
  const reLook: ReLookEntry[] = [];
  for (const [index, group] of previousBrief.changeGroups.entries()) {
    const files = groupFiles[index]?.files ?? [];
    const verdict = verdicts[index];
    const demote = (reason: string) => {
      reLook.push({ id: group.id, files, reason });
    };
    if (sharedForced.has(group.id)) {
      demote("file shared across previous groups — cannot carry exclusively");
      continue;
    }
    if (verdict === undefined || verdict.verdict === GroupVerdicts.RE_LOOK) {
      demote(verdict?.reason ?? "no partition verdict");
      continue;
    }
    const chunks = previousBrief.chunks.filter(
      (chunk) => chunk.changeGroupId === group.id,
    );
    if (chunks.length === 0) {
      demote("previous group has no chunks — nothing carriable");
      continue;
    }
    // Under the file-level predicate a frozen file has no hunks, so this is
    // identity, but contradictory evidence (a hunk in a "clean" file) must
    // demote, never carry wrong lines.
    const remapped: Chunk[] = [];
    let demoted: string | undefined;
    for (const chunk of chunks) {
      const result = remapThroughPatch(
        chunk.addedRanges,
        patches.get(chunk.file) ?? "",
      );
      if (result.outcome === RemapOutcomes.DEMOTED) {
        demoted = `${chunk.file}: ${result.reason}`;
        break;
      }
      remapped.push({ ...chunk, addedRanges: [...result.ranges] });
    }
    if (demoted !== undefined) {
      demote(`range remap ambiguous — ${demoted}`);
      continue;
    }
    frozen.push({ group, chunks: remapped });
    for (const file of files) {
      frozenFiles.add(file);
    }
  }

  const plan: Mutable<AnchorPlan> = {
    frozen,
    frozenFiles,
    reLook,
    previousGroupIds: reserveIds(previousBrief, chainGroupIds),
  };

  if (compareFiles.complete) {
    plan.hunkSpans = buildHop(compareFiles, patches);
  }

  return plan;
}

/** The compare endpoint's entry as the partition reads it. */
function shapeCompareFileEntry(file: CompareFile): CompareFileEntry {
  const entry: Mutable<CompareFileEntry> = {
    file: file.filename,
    status: file.status,
  };

  if (file.previousFilename !== undefined) {
    entry.previousFile = file.previousFilename;
  }

  return entry;
}

/** Dominant frozen parent for a dropped generated group (tie → first frozen). */
function dominantFrozenParent(
  files: readonly string[],
  frozen: readonly FrozenCarry[],
  frozenChunkFiles: ReadonlyMap<string, ReadonlySet<string>>,
): string | undefined {
  let bestId: string | undefined;
  let bestCount = 0;
  for (const carry of frozen) {
    const owned = frozenChunkFiles.get(carry.group.id);
    if (owned === undefined) {
      continue;
    }
    let count = 0;
    for (const file of new Set(files)) {
      if (owned.has(file)) {
        count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestId = carry.group.id;
    }
  }
  return bestId;
}

/** A carry may only describe files the PR still changes; an emptied carry goes whole. */
function dropDepartedCarries(
  carries: readonly FrozenCarry[],
  prFiles: ReadonlySet<string>,
  issues: string[],
): FrozenCarry[] {
  return carries.flatMap((carry) => {
    const chunks = carry.chunks.filter((chunk) => {
      if (prFiles.has(chunk.file)) {
        return true;
      }
      issues.push(
        `carried chunk ${chunk.id} on ${chunk.file} dropped, the PR no longer changes it`,
      );
      return false;
    });

    if (chunks.length === 0) {
      issues.push(
        `carried group ${carry.group.id} dropped, none of its files remain in the PR`,
      );
      return [];
    }
    return [{ group: carry.group, chunks }];
  });
}

/** Many model ids can name one final group, so the mapped list is a set. */
function remapGroupIds(
  ids: readonly string[],
  referenceMap: ReadonlyMap<string, string>,
): string[] {
  return [...new Set(ids.map((id) => referenceMap.get(id) ?? id))];
}

function remapIntentItems(
  items: readonly IntentItem[],
  referenceMap: ReadonlyMap<string, string>,
): IntentItem[] {
  return items.map((item) => ({
    ...item,
    groupIds: remapGroupIds(item.groupIds, referenceMap),
  }));
}

function remapIntentCheck(
  intentCheck: IntentCheck,
  referenceMap: ReadonlyMap<string, string>,
): IntentCheck {
  return {
    ...intentCheck,
    accomplished: remapIntentItems(intentCheck.accomplished, referenceMap),
    statedButMissing: remapIntentItems(
      intentCheck.statedButMissing,
      referenceMap,
    ),
    doneButUnstated: remapIntentItems(
      intentCheck.doneButUnstated,
      referenceMap,
    ),
    deviations: remapIntentItems(intentCheck.deviations, referenceMap),
    maskedFixes: remapIntentItems(intentCheck.maskedFixes, referenceMap),
  };
}

/**
 * Merge only: carry frozen regions verbatim, judge claims, descend ids and
 * re-point the model's references to them. Validation, rollups and the
 * unattributed remainder belong to the final pass over the merged brief.
 */
export function stitchBrief(args: StitchArgs): StitchResult {
  const { plan, prFiles } = args;
  const issues: string[] = [];

  // The model can resurrect files removed from the PR because they remain in the anchor
  // or re-look diff. Drop them before judging claims so they cannot survive or supply evidence.
  const prFileSet = new Set(prFiles);
  const departedFiles = [
    ...new Set(
      args.generated.chunks
        .map((chunk) => chunk.file)
        .filter((file) => !prFileSet.has(file)),
    ),
  ];
  for (const file of departedFiles) {
    issues.push(
      `generated chunk on ${file} dropped — the PR no longer changes it`,
    );
  }
  const generated =
    departedFiles.length === 0
      ? args.generated
      : {
          ...args.generated,
          chunks: args.generated.chunks.filter((chunk) =>
            prFileSet.has(chunk.file),
          ),
        };

  // A claim cancels a frozen carry only when it re-emits a previous file from that group.
  // An id collision with no file overlap is a numbering slip and must take normal descent.
  // Valid claims replace the whole group because the model re-examined it.
  const frozenFilesById = new Map(
    plan.frozen.map((carry) => [
      carry.group.id,
      new Set(carry.chunks.map((chunk) => chunk.file)),
    ]),
  );
  const generatedFilesById = new Map<string, Set<string>>();
  for (const chunk of generated.chunks) {
    const files = generatedFilesById.get(chunk.changeGroupId) ?? new Set();
    files.add(chunk.file);
    generatedFilesById.set(chunk.changeGroupId, files);
  }
  const claimedIds = new Set<string>();
  for (const group of generated.changeGroups) {
    const frozenFiles = frozenFilesById.get(group.id);
    if (frozenFiles === undefined) {
      continue;
    }
    const emitted = generatedFilesById.get(group.id) ?? new Set<string>();
    const overlaps = [...emitted].some((file) => frozenFiles.has(file));
    // Evidence is judged against the UNION of frozen files: no frozen file
    // can witness a claim (the re-look diff never touches one), so a mashed
    // re-emission of two frozen groups is drift, not a claim.
    const newEvidence = [...emitted].some(
      (file) => !plan.frozenFiles.has(file),
    );
    if (overlaps && newEvidence) {
      claimedIds.add(group.id);
      issues.push(
        `frozen group ${group.id} claimed by the model output — unfrozen and re-examined`,
      );
    } else if (overlaps) {
      // The re-emission holds nothing beyond the group's own frozen files,
      // no new file is joining, so there is no claim evidence (the re-look
      // diff cannot have touched a frozen file by construction). The carry
      // survives; the model's drift is discarded with the frozen chunks.
      issues.push(
        `frozen group ${group.id} re-emitted without a new file — no claim evidence, carry kept`,
      );
    } else {
      issues.push(
        `generated group reused frozen id ${group.id} without its files — treated as a numbering slip, not a claim`,
      );
    }
  }
  const activeFrozen = dropDepartedCarries(
    plan.frozen.filter((carry) => !claimedIds.has(carry.group.id)),
    prFileSet,
    issues,
  );
  const activeFrozenFiles = new Set(
    activeFrozen.flatMap((carry) => carry.chunks.map((chunk) => chunk.file)),
  );

  // ---- split the generated output around the (still-)frozen file set ------
  const keptChunks = generated.chunks.filter(
    (chunk) => !activeFrozenFiles.has(chunk.file),
  );
  const keptFilesByGroup = new Map<string, string[]>();
  const allFilesByGroup = new Map<string, string[]>();
  for (const chunk of generated.chunks) {
    const all = allFilesByGroup.get(chunk.changeGroupId) ?? [];
    if (!all.includes(chunk.file)) {
      all.push(chunk.file);
    }
    allFilesByGroup.set(chunk.changeGroupId, all);
  }
  for (const chunk of keptChunks) {
    const kept = keptFilesByGroup.get(chunk.changeGroupId) ?? [];
    if (!kept.includes(chunk.file)) {
      kept.push(chunk.file);
    }
    keptFilesByGroup.set(chunk.changeGroupId, kept);
  }
  const keptGroups = generated.changeGroups.filter((group) =>
    keptFilesByGroup.has(group.id),
  );
  const droppedGroups = generated.changeGroups.filter(
    (group) => !keptFilesByGroup.has(group.id),
  );

  // ---- id descent for surviving groups ------------------------------------
  // Claimed groups keep their claimed id by construction and stay OUT of
  // descent (their id is already final); everything they claimed stays
  // reserved via previousGroupIds.
  const carriedIds = activeFrozen.map((carry) => carry.group.id);
  const reLookPrevious = plan.reLook.map((entry) => ({
    id: entry.id,
    files: entry.files,
  }));
  const descended = assignGroupIds({
    generated: keptGroups
      .filter((group) => !claimedIds.has(group.id))
      .map((group) => ({
        id: group.id,
        files: keptFilesByGroup.get(group.id) ?? [],
      })),
    previous: reLookPrevious,
    reservedIds: [...carriedIds, ...plan.previousGroupIds],
  });

  // Reference map: surviving groups → descended id (claimed → themselves);
  // dropped groups → their dominant frozen parent (their region IS the
  // carried group), so intent / ordering references keep resolving instead
  // of dangling.
  const frozenChunkFiles = new Map<string, ReadonlySet<string>>(
    activeFrozen.map((carry) => [
      carry.group.id,
      new Set(carry.chunks.map((chunk) => chunk.file)),
    ]),
  );
  const referenceMap = new Map<string, string>();
  for (const group of keptGroups) {
    if (claimedIds.has(group.id)) {
      referenceMap.set(group.id, group.id);
      continue;
    }
    const id = descended.get(group.id);
    if (id !== undefined) {
      referenceMap.set(group.id, id);
    }
  }
  for (const group of droppedGroups) {
    const parent = dominantFrozenParent(
      allFilesByGroup.get(group.id) ?? [],
      activeFrozen,
      frozenChunkFiles,
    );
    if (parent !== undefined) {
      referenceMap.set(group.id, parent);
    }
  }

  // ---- rebuild groups + chunks --------------------------------------------
  const mergedGroups: ChangeGroup[] = [
    ...activeFrozen.map((carry) => carry.group),
    ...keptGroups.map((group) => {
      const id = descended.get(group.id);
      return id === undefined ? group : { ...group, id };
    }),
  ];

  const usedChunkIds = new Set<string>();
  const carriedChunks = activeFrozen.flatMap((carry) => carry.chunks);
  for (const chunk of carriedChunks) {
    usedChunkIds.add(chunk.id);
  }
  let chunkMint = 1;
  const mintChunkId = (): string => {
    let candidate = `c${chunkMint}`;
    while (usedChunkIds.has(candidate)) {
      chunkMint++;
      candidate = `c${chunkMint}`;
    }
    usedChunkIds.add(candidate);
    return candidate;
  };
  const rewrittenChunks = keptChunks.map((chunk) => {
    const groupId = referenceMap.get(chunk.changeGroupId);
    const id = usedChunkIds.has(chunk.id) ? mintChunkId() : chunk.id;
    usedChunkIds.add(id);
    return {
      ...chunk,
      id,
      changeGroupId: groupId ?? chunk.changeGroupId,
    };
  });
  const mergedChunks: Chunk[] = [...carriedChunks, ...rewrittenChunks];

  const carriedGroupIds = carriedIds;
  const regeneratedGroupIds = keptGroups.flatMap((group) => {
    if (claimedIds.has(group.id)) {
      return [group.id];
    }
    const id = descended.get(group.id);
    return id === undefined ? [] : [id];
  });
  const brief: Brief = {
    ...generated,
    changeGroups: mergedGroups,
    chunks: mergedChunks,
    anchoring: {
      carried: [...carriedGroupIds],
      regenerated: [...regeneratedGroupIds],
    },
  };

  if (generated.readingOrder !== undefined) {
    brief.readingOrder = generated.readingOrder.map((step) => ({
      ...step,
      groupId: referenceMap.get(step.groupId) ?? step.groupId,
    }));
  }
  if (generated.intentCheck !== undefined) {
    brief.intentCheck = remapIntentCheck(generated.intentCheck, referenceMap);
  }

  return {
    brief,
    carriedGroupIds,
    carriedChunkIds: carriedChunks.map((chunk) => chunk.id),
    regeneratedGroupIds,
    issues,
  };
}
