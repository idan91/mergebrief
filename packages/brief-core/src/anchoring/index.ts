// Pure anchored-generation helpers: the plan step (partition previous groups
// into frozen | re-look, with remap-as-invariant-assertion) and the stitch
// step (carry frozen groups verbatim, keep the regenerated rest, rewrite ids
// by descent, recompute the mechanical rollup, enforce coverage). No I/O, no
// model calls; the worker's generate task wires these around the categorize
// call, and the eval harness's revision-pair runner exercises the same code.
import type { Result } from "types";
import { assignGroupIds } from "../diff/descent";
import { splitDiffByFile } from "../diff/diff";
import {
  parseHunkSpans,
  remapThroughPatch,
  RemapOutcomes,
  type Hop,
  type HunkSpan,
} from "../diff/remap";
import { parseChangedRanges } from "../diff/revchanges";
import { GroupVerdicts, partitionGroups } from "../diff/touched";
import {
  buildConcernView,
  deriveUnattributed,
  detectChunkOverlaps,
  diffLocTotals,
  unattributedTotals,
} from "../generation/loc";
import { validatePartition, validateTextLength } from "../generation/validate";
import type { Brief } from "../types";
import type {
  AnchorPlan,
  AnchorPlanArgs,
  ChangeGroup,
  Chunk,
  CompareFiles,
  FrozenCarry,
  ReLookEntry,
  StitchArgs,
  StitchError,
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

/** Previous-brief ids ∪ the chain's — deduped, previous first. */
function reserveIds(brief: Brief, chainGroupIds: readonly string[]): string[] {
  return [
    ...new Set([
      ...brief.changeGroups.map((group) => group.id),
      ...chainGroupIds,
    ]),
  ];
}

/**
 * The hop for this push: one entry per path the push touched, its `@@`
 * coordinates parsed from that path's patch. Keyed by path, and zero hunks
 * always wins a collision — an anchor entering the hop sits on the pre-push
 * tree, so a path that was renamed away (or that the patch and the compare
 * list disagree about) must demote rather than settle on unrelated new code.
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
    if (!byPath.has(file)) byPath.set(file, []);
  }
  for (const file of compareFiles.files) {
    if (file.previousFilename !== undefined) {
      byPath.set(file.previousFilename, []);
    }
  }
  return [...byPath].map(([file, hunks]) => ({ file, hunks }));
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
    // shows 'diverged' here — and then the three-dot span diffs from the
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
    // Under the file-level predicate a frozen file has no hunks, so this is
    // identity — but contradictory evidence (a hunk in a "clean" file) must
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

  return {
    frozen,
    frozenFiles,
    reLook,
    previousGroupIds: reserveIds(previousBrief, chainGroupIds),
    ...(compareFiles.complete
      ? { hunkSpans: buildHop(compareFiles, patches) }
      : {}),
  };
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
  const { plan, prFiles } = args;
  const warnings: string[] = [];

  // ---- scrub generated chunks on files the PR no longer changes -----------
  // The model can resurrect a departed file from the anchor brief (a revision
  // that reverts a file out of the PR still shows it in the re-look diff and
  // the previous brief). Chunks outside the PR's file universe are noise:
  // drop them before claims are judged so a departed file can neither survive
  // into the brief nor serve as claim evidence.
  const prFileSet = new Set(prFiles);
  const departedFiles = [
    ...new Set(
      args.generated.chunks
        .map((chunk) => chunk.file)
        .filter((file) => !prFileSet.has(file)),
    ),
  ];
  for (const file of departedFiles) {
    warnings.push(
      `anchored stitch: generated chunk on ${file} dropped — the PR no longer changes it`,
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

  // ---- claims: a generated group under a frozen id UNFREEZES it -----------
  // The prompt contract forbids frozen ids except as claim targets (a new
  // file joining a frozen group); a claim means the model re-examined the
  // whole group, so its version wins and the carry is cancelled. A claim is
  // validated MECHANICALLY: the claiming group must re-emit at least one of
  // the frozen group's previous files — a bare id collision with zero file
  // overlap is a numbering slip, not a claim, and routes through descent like
  // any other temp id instead of cancelling a carry it never referenced.
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
    if (frozenFiles === undefined) continue;
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
      warnings.push(
        `anchored stitch: frozen group ${group.id} claimed by the model output — unfrozen and re-examined`,
      );
    } else if (overlaps) {
      // The re-emission holds nothing beyond the group's own frozen files —
      // no new file is joining, so there is no claim evidence (the re-look
      // diff cannot have touched a frozen file by construction). The carry
      // survives; the model's drift is discarded with the frozen chunks.
      warnings.push(
        `anchored stitch: frozen group ${group.id} re-emitted without a new file — no claim evidence, carry kept`,
      );
    } else {
      warnings.push(
        `anchored stitch: generated group reused frozen id ${group.id} without its files — treated as a numbering slip, not a claim`,
      );
    }
  }
  const activeFrozen = plan.frozen.filter(
    (carry) => !claimedIds.has(carry.group.id),
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
    if (id !== undefined) referenceMap.set(group.id, id);
  }
  for (const group of droppedGroups) {
    const parent = dominantFrozenParent(
      allFilesByGroup.get(group.id) ?? [],
      activeFrozen,
      frozenChunkFiles,
    );
    if (parent !== undefined) referenceMap.set(group.id, parent);
  }

  // ---- rebuild groups + chunks --------------------------------------------
  const mergedGroups: ChangeGroup[] = [
    ...activeFrozen.map((carry) => carry.group),
    ...keptGroups.map((group) => {
      const id = descended.get(group.id);
      return id === undefined ? group : { ...group, id };
    }),
  ];
  const mergedGroupIds = new Set(mergedGroups.map((group) => group.id));

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

  // ---- mechanical concern rollup (the model's is stale after a stitch) ----
  const concernView = buildConcernView(mergedChunks);

  // ---- overlap report over the MERGED chunk set ---------------------------
  // Replaces categorize()'s lines, which name model tmp chunk ids that the
  // id re-mint above may have reassigned in the stored artifact.
  for (const issue of detectChunkOverlaps(mergedChunks)) {
    warnings.push(`anchored stitch: ${issue}`);
  }

  // ---- unattributed remainder over the MERGED chunk set -------------------
  // categorize() skips this on anchored runs; only the stitch sees carried +
  // regenerated chunks together, so only it can derive an honest remainder.
  const unattributed = deriveUnattributed(mergedChunks, [...args.changedFiles]);
  if (unattributed.length > 0) {
    const gap = unattributedTotals(unattributed);
    warnings.push(
      `anchored stitch: ${gap.added} added / ${gap.deleted} removed changed line(s) unattributed to any chunk across ${unattributed.length} file(s)`,
    );
  }

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

  // ---- coverage: every PR file in exactly one group (hard) ----------------
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
  for (const carry of activeFrozen) {
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

  // Full structural validators on the artifact actually persisted —
  // warn-register, matching their fresh-path posture.
  for (const issue of validatePartition(mergedGroups, mergedChunks)) {
    warnings.push(`anchored stitch: ${issue}`);
  }
  // Length floor over the MERGED artifact — carried groups included, so a
  // pre-cap carry is measured too; replaces the partial stamp `categorize()`
  // computed on the re-emitted regions alone.
  const textLength = validateTextLength(mergedGroups, mergedChunks);
  for (const issue of textLength.issues) {
    warnings.push(`anchored stitch: ${issue}`);
  }

  const carriedGroupIds = carriedIds;
  const regeneratedGroupIds = keptGroups.flatMap((group) => {
    if (claimedIds.has(group.id)) return [group.id];
    const id = descended.get(group.id);
    return id === undefined ? [] : [id];
  });
  // The stitch's recomputed text-length and overlap lines REPLACE
  // categorize()'s — those name the model's tmp ids, which don't exist in
  // the stored artifact (same replacement discipline as lengthViolations).
  const priorWarnings = (generated.generationWarnings ?? []).filter(
    (line) =>
      !line.includes("text length issues") && !line.includes("loc overlap"),
  );
  const mergedWarnings = [...priorWarnings, ...warnings];
  const brief: Brief = {
    ...generated,
    changeGroups: mergedGroups,
    chunks: mergedChunks,
    concernView,
    unattributed,
    diffTotals: diffLocTotals([...args.changedFiles]),
    ...(readingOrder === undefined ? {} : { readingOrder }),
    ...(intentCheck === undefined ? {} : { intentCheck }),
    // Always overwritten below: an empty merged set must DELETE the field,
    // or the filtered-out originals survive via the `...generated` spread.
    anchoring: {
      carried: [...carriedGroupIds],
      regenerated: [...regeneratedGroupIds],
    },
  };
  if (readingOrder === undefined) {
    delete brief.readingOrder;
  }
  if (mergedWarnings.length > 0) {
    brief.generationWarnings = mergedWarnings;
  } else {
    delete brief.generationWarnings;
  }
  if (textLength.violations.length > 0) {
    brief.lengthViolations = textLength.violations;
  } else {
    delete brief.lengthViolations;
  }
  return {
    ok: true,
    value: {
      brief,
      carriedGroupIds,
      carriedChunkIds: carriedChunks.map((chunk) => chunk.id),
      regeneratedGroupIds,
    },
  };
}
