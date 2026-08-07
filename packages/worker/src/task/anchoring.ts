// Pure anchored-generation helpers (BRIEF-143 PR 3): the plan step (partition
// previous groups into frozen | re-look, with remap-as-invariant-assertion)
// and the stitch step (carry frozen groups verbatim, keep the regenerated
// rest, rewrite ids by descent, recompute the mechanical rollup, enforce
// coverage). No I/O, no model calls — `generate.ts` wires these around the
// existing categorize call.
import {
  assignGroupIds,
  GroupVerdicts,
  parseChangedRanges,
  partitionGroups,
  remapThroughPatch,
  RemapOutcomes,
  splitDiffByFile,
  validatePartition,
  type Brief,
} from "brief-core";
import type { CompareFiles } from "github";
import type { Result } from "types";

type ChangeGroup = Brief["changeGroups"][number];
type Chunk = Brief["chunks"][number];

export interface AnchorPlanArgs {
  readonly previousBrief: Brief;
  /** The prevHead→head raw span diff; undefined = fetch failed (nothing confirmable). */
  readonly incrementalDiff?: string;
  /** Compare per-file metadata; undefined = fetch failed (nothing confirmable). */
  readonly compareFiles?: CompareFiles;
  /**
   * True when the PR-base SHA moved since the previous brief (rebase /
   * base-advance): three-dot compare data lies after a rewrite, so
   * everything re-looks BEFORE the partition even runs (spec: rebase noise
   * takes the conservative path).
   */
  readonly baseShaMoved: boolean;
}

/** One frozen group carried verbatim: its definition + (remapped) chunks. */
export interface FrozenCarry {
  readonly group: ChangeGroup;
  readonly chunks: readonly Chunk[];
}

export interface ReLookEntry {
  readonly id: string;
  readonly files: readonly string[];
  readonly reason?: string;
}

export interface AnchorPlan {
  readonly frozen: readonly FrozenCarry[];
  /** Union of the frozen groups' files — the withhold/drop set. */
  readonly frozenFiles: ReadonlySet<string>;
  readonly reLook: readonly ReLookEntry[];
  readonly previousGroupIds: readonly string[];
}

/** Files per previous group, from its chunks (order-stable, deduped). */
function filesOf(brief: Brief, groupId: string): string[] {
  const files: string[] = [];
  for (const chunk of brief.chunks) {
    if (chunk.changeGroupId === groupId && !files.includes(chunk.file)) {
      files.push(chunk.file);
    }
  }
  return files;
}

function allReLook(brief: Brief, reason: string): AnchorPlan {
  return {
    frozen: [],
    frozenFiles: new Set(),
    reLook: brief.changeGroups.map((group) => ({
      id: group.id,
      files: filesOf(brief, group.id),
      reason,
    })),
    previousGroupIds: brief.changeGroups.map((group) => group.id),
  };
}

/**
 * Partition the previous brief's groups into frozen carries and re-looks.
 * Conservative at every step: rebase/base-advance, a missing span diff or
 * compare list, files shared across previous groups (coverage exclusivity —
 * two groups cannot both carry the same file), and any ambiguous range remap
 * all land in re-look.
 */
export function planAnchoredGeneration(args: AnchorPlanArgs): AnchorPlan {
  const { previousBrief, incrementalDiff, compareFiles, baseShaMoved } = args;
  if (baseShaMoved) {
    return allReLook(
      previousBrief,
      "base SHA moved (rebase/base-advance) — three-dot span data untrusted",
    );
  }
  if (incrementalDiff === undefined) {
    return allReLook(previousBrief, "incremental span diff unavailable");
  }
  if (compareFiles === undefined) {
    return allReLook(previousBrief, "compare file metadata unavailable");
  }
  if (compareFiles.status !== "ahead") {
    // A same-base force-push (amend/squash/drop) never moves the base SHA but
    // shows 'diverged' here — and then the three-dot span diffs from the
    // divergence point, not prevHead, so "absent from the span" proves
    // nothing. Only a fast-forward span is trustworthy evidence.
    return allReLook(
      previousBrief,
      `compare span status '${compareFiles.status ?? "unknown"}' — not a fast-forward push`,
    );
  }

  const groupFiles = previousBrief.changeGroups.map((group) => ({
    id: group.id,
    files: filesOf(previousBrief, group.id),
  }));

  // Coverage exclusivity: a file owned by two previous groups can only be
  // carried once — force every co-owner to re-look and let the model (and
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
    compareFiles: compareFiles.files.map((file) => ({
      file: file.filename,
      status: file.status,
      ...(file.previousFilename === undefined
        ? {}
        : { previousFile: file.previousFilename }),
    })),
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
    // Remap-as-invariant (PR 2 review): under the file-level predicate a
    // frozen file has no hunks, so this is identity — but contradictory
    // evidence (a hunk in a "clean" file) must demote, never carry wrong
    // lines.
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

  return {
    frozen,
    frozenFiles,
    reLook,
    previousGroupIds: previousBrief.changeGroups.map((group) => group.id),
  };
}

export interface StitchArgs {
  /** The fresh categorize output (model temp ids, may re-cover frozen files). */
  readonly generated: Brief;
  readonly plan: AnchorPlan;
  /** Every changed file path of the PR — the coverage check's universe. */
  readonly prFiles: readonly string[];
}

export interface StitchResult {
  readonly brief: Brief;
  readonly carriedGroupIds: readonly string[];
  readonly regeneratedGroupIds: readonly string[];
}

export interface StitchError {
  readonly message: string;
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
    if (owned === undefined) continue;
    let count = 0;
    for (const file of new Set(files)) {
      if (owned.has(file)) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestId = carry.group.id;
    }
  }
  return bestId;
}

/**
 * Merge frozen carries with the generated regions: drop the model's take on
 * frozen files, rewrite surviving ids by descent, re-point references,
 * recompute the mechanical concern rollup, and enforce the coverage
 * invariant (every PR file in exactly one group). Coverage failure is a
 * pipeline error (Result), never salvage.
 */
export function stitchBrief(
  args: StitchArgs,
): Result<StitchResult, StitchError> {
  const { generated, plan, prFiles } = args;
  const warnings: string[] = [];

  // ---- split the generated output around the frozen file set ---------------
  const keptChunks = generated.chunks.filter(
    (chunk) => !plan.frozenFiles.has(chunk.file),
  );
  const keptFilesByGroup = new Map<string, string[]>();
  const allFilesByGroup = new Map<string, string[]>();
  for (const chunk of generated.chunks) {
    const all = allFilesByGroup.get(chunk.changeGroupId) ?? [];
    if (!all.includes(chunk.file)) all.push(chunk.file);
    allFilesByGroup.set(chunk.changeGroupId, all);
  }
  for (const chunk of keptChunks) {
    const kept = keptFilesByGroup.get(chunk.changeGroupId) ?? [];
    if (!kept.includes(chunk.file)) kept.push(chunk.file);
    keptFilesByGroup.set(chunk.changeGroupId, kept);
  }
  const keptGroups = generated.changeGroups.filter((group) =>
    keptFilesByGroup.has(group.id),
  );
  const droppedGroups = generated.changeGroups.filter(
    (group) => !keptFilesByGroup.has(group.id),
  );

  // ---- id descent for surviving groups ------------------------------------
  const frozenIds = plan.frozen.map((carry) => carry.group.id);
  const reLookPrevious = plan.reLook.map((entry) => ({
    id: entry.id,
    files: entry.files,
  }));
  const descended = assignGroupIds({
    generated: keptGroups.map((group) => ({
      id: group.id,
      files: keptFilesByGroup.get(group.id) ?? [],
    })),
    previous: reLookPrevious,
    reservedIds: [...frozenIds, ...plan.previousGroupIds],
  });

  // Reference map: surviving groups → descended id; dropped groups → their
  // dominant frozen parent (their region IS the carried group), so intent /
  // ordering references keep resolving instead of dangling.
  const frozenChunkFiles = new Map<string, ReadonlySet<string>>(
    plan.frozen.map((carry) => [
      carry.group.id,
      new Set(carry.chunks.map((chunk) => chunk.file)),
    ]),
  );
  const referenceMap = new Map<string, string>();
  for (const group of keptGroups) {
    const id = descended.get(group.id);
    if (id !== undefined) referenceMap.set(group.id, id);
  }
  for (const group of droppedGroups) {
    const parent = dominantFrozenParent(
      allFilesByGroup.get(group.id) ?? [],
      plan.frozen,
      frozenChunkFiles,
    );
    if (parent !== undefined) referenceMap.set(group.id, parent);
  }

  // ---- rebuild groups + chunks --------------------------------------------
  const mergedGroups: ChangeGroup[] = [
    ...plan.frozen.map((carry) => carry.group),
    ...keptGroups.map((group) => {
      const id = descended.get(group.id);
      return id === undefined ? group : { ...group, id };
    }),
  ];
  const mergedGroupIds = new Set(mergedGroups.map((group) => group.id));

  const usedChunkIds = new Set<string>();
  const carriedChunks = plan.frozen.flatMap((carry) => carry.chunks);
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

  // ---- mechanical concern rollup (the model's is stale after a stitch) ----
  type Concern = Chunk["concern"];
  const rollup = new Map<Concern, { added: number; deleted: number }>();
  for (const chunk of mergedChunks) {
    const entry = rollup.get(chunk.concern) ?? { added: 0, deleted: 0 };
    entry.added += chunk.loc.added;
    entry.deleted += chunk.loc.deleted;
    rollup.set(chunk.concern, entry);
  }
  const concernView = [...rollup.entries()].map(([concern, loc]) => ({
    concern,
    added: loc.added,
    deleted: loc.deleted,
  }));

  // ---- reading order: rewrite ids, keep only an exact permutation ---------
  let readingOrder = generated.readingOrder;
  if (readingOrder !== undefined) {
    const mapped = readingOrder.map((step) => ({
      ...step,
      groupId: referenceMap.get(step.groupId) ?? step.groupId,
    }));
    const seen = new Set(mapped.map((step) => step.groupId));
    const isPermutation =
      mapped.length === mergedGroups.length &&
      seen.size === mapped.length &&
      mergedGroups.every((group) => seen.has(group.id));
    if (isPermutation) {
      readingOrder = mapped;
    } else {
      readingOrder = undefined;
      warnings.push(
        "anchored stitch: reading order dropped — not a permutation of the merged groups",
      );
    }
  }

  // ---- intent check: re-point group references, drop danglers -------------
  let intentCheck = generated.intentCheck;
  if (intentCheck !== undefined) {
    const rewriteIds = (ids: readonly string[]): string[] => {
      const mapped: string[] = [];
      for (const id of ids) {
        const finalId = referenceMap.get(id) ?? id;
        if (mergedGroupIds.has(finalId) && !mapped.includes(finalId)) {
          mapped.push(finalId);
        }
      }
      return mapped;
    };
    const scrubBucket = <T extends { groupIds: string[]; intent: string }>(
      items: readonly T[],
      requiresAnchor: boolean,
    ): T[] =>
      items.flatMap((item) => {
        const groupIds = rewriteIds(item.groupIds);
        if (requiresAnchor && groupIds.length === 0) {
          warnings.push(
            `anchored stitch: intent item dropped (dangling group anchor) — ${item.intent}`,
          );
          return [];
        }
        return [{ ...item, groupIds }];
      });
    intentCheck = {
      ...intentCheck,
      accomplished: scrubBucket(intentCheck.accomplished, true),
      statedButMissing: scrubBucket(intentCheck.statedButMissing, false),
      doneButUnstated: scrubBucket(intentCheck.doneButUnstated, true),
      deviations: scrubBucket(intentCheck.deviations, true),
      claimedButUnachieved: scrubBucket(intentCheck.claimedButUnachieved, true),
    };
  }

  // ---- coverage: every PR file in exactly one group (hard, per spec) ------
  const ownersByFile = new Map<string, Set<string>>();
  for (const chunk of mergedChunks) {
    const owners = ownersByFile.get(chunk.file) ?? new Set<string>();
    owners.add(chunk.changeGroupId);
    ownersByFile.set(chunk.file, owners);
  }
  const coverageIssues: string[] = [];
  for (const file of prFiles) {
    const owners = ownersByFile.get(file);
    if (owners === undefined || owners.size === 0) {
      coverageIssues.push(`${file}: in no group`);
    } else if (owners.size > 1) {
      coverageIssues.push(
        `${file}: in ${owners.size} groups (${[...owners].toSorted().join(", ")})`,
      );
    }
  }
  // Backstop for the mechanical guarantee: a carried group may only describe
  // files the PR still changes — a stale carry (e.g. an undetected history
  // rewrite dropping a file) must fail here, never persist.
  const prFileSet = new Set(prFiles);
  for (const carry of plan.frozen) {
    for (const chunk of carry.chunks) {
      if (!prFileSet.has(chunk.file)) {
        coverageIssues.push(
          `${chunk.file}: carried by ${carry.group.id} but no longer in the PR`,
        );
      }
    }
  }
  if (coverageIssues.length > 0) {
    return {
      ok: false,
      error: {
        message: `anchored coverage check failed — ${coverageIssues.join("; ")}`,
      },
    };
  }

  // Full structural validators on the artifact actually persisted (spec
  // §Stitch & validation) — warn-register, matching their fresh-path posture.
  for (const issue of validatePartition(mergedGroups, mergedChunks)) {
    warnings.push(`anchored stitch: ${issue}`);
  }

  const carriedGroupIds = frozenIds;
  const regeneratedGroupIds = keptGroups.flatMap((group) => {
    const id = descended.get(group.id);
    return id === undefined ? [] : [id];
  });
  const priorWarnings = generated.generationWarnings ?? [];
  const mergedWarnings = [...priorWarnings, ...warnings];
  const brief: Brief = {
    ...generated,
    changeGroups: mergedGroups,
    chunks: mergedChunks,
    concernView,
    ...(readingOrder === undefined ? {} : { readingOrder }),
    ...(intentCheck === undefined ? {} : { intentCheck }),
    ...(mergedWarnings.length > 0
      ? { generationWarnings: mergedWarnings }
      : {}),
    anchoring: {
      carried: [...carriedGroupIds],
      regenerated: [...regeneratedGroupIds],
    },
  };
  if (readingOrder === undefined) {
    delete brief.readingOrder;
  }
  return { ok: true, value: { brief, carriedGroupIds, regeneratedGroupIds } };
}
