// Pure anchored planning and stitching shared by the worker and revision-pair evals.
// Carry frozen groups verbatim and remap ids by descent without model calls.
import type { Result } from "types/utils";
import { assignGroupIds } from "../diff/descent";
import type { PrSpan } from "../diff/pr-span/types";
import {
  remapRanges,
  RemapOutcomes,
  type Hop,
  type HunkSpan,
  type RemapResult,
} from "../diff/remap";
import {
  AnchorWarnings,
  type Brief,
  type IntentCheck,
  type IntentItem,
  type LineRange,
  type ReadingOrderStep,
} from "../types";
import type {
  AnchorPlan,
  AnchorPlanArgs,
  ChangeGroup,
  Chunk,
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
    warnings: [AnchorWarnings.SPAN_UNAVAILABLE],
  };
}

/** Previous-brief ids ∪ the chain's, deduped, previous first: the ids no new group may take. */
export function reserveIds(
  brief: Brief,
  chainGroupIds: readonly string[],
): string[] {
  return [
    ...new Set([
      ...brief.changeGroups.map((group) => group.id),
      ...chainGroupIds,
    ]),
  ];
}

/** A span read failed: nothing is confirmable, so every group re-looks. */
const SPAN_UNREAD_REASON = "the revision span could not be read";

/** One side's spans per previous-head path. */
type SideSpans = ReadonlyMap<string, readonly HunkSpan[]>;

function indexHop(hop: Hop): SideSpans {
  return new Map(hop.map((entry) => [entry.file, entry.hunks]));
}

/** A file whose hop entry holds no span cannot place a range, so its ranges demote. */
function remapOnSide(
  spans: SideSpans,
  file: string,
  ranges: readonly LineRange[],
): RemapResult {
  if (ranges.length === 0) {
    return { outcome: RemapOutcomes.REMAPPED, ranges: [] };
  }
  const hunks = spans.get(file) ?? [];
  if (hunks.length === 0) {
    return {
      outcome: RemapOutcomes.DEMOTED,
      reason: `no span pairs ${file} across the push`,
    };
  }
  return remapRanges(ranges, hunks);
}

interface SpanSides {
  readonly added: SideSpans;
  readonly removed: SideSpans;
}

/** A frozen chunk's ranges on the new head, or why one cannot be placed. */
function moveChunk(chunk: Chunk, sides: SpanSides): Result<Chunk, string> {
  const added = remapOnSide(sides.added, chunk.file, chunk.addedRanges);
  if (added.outcome === RemapOutcomes.DEMOTED) {
    return { ok: false, error: `${chunk.file}: ${added.reason}` };
  }
  const removed = remapOnSide(sides.removed, chunk.file, chunk.removedRanges);
  if (removed.outcome === RemapOutcomes.DEMOTED) {
    return { ok: false, error: `${chunk.file}: ${removed.reason}` };
  }

  const moved = {
    ...chunk,
    addedRanges: [...added.ranges],
    removedRanges: [...removed.ranges],
  };
  return { ok: true, value: moved };
}

/** Every chunk of a group moved, or the first reason one cannot be. */
function moveChunks(
  chunks: readonly Chunk[],
  sides: SpanSides,
): Result<Chunk[], string> {
  const moved: Chunk[] = [];
  for (const chunk of chunks) {
    const result = moveChunk(chunk, sides);
    if (!result.ok) {
      return result;
    }
    moved.push(result.value);
  }
  return { ok: true, value: moved };
}

interface GroupCarryInput {
  readonly previousBrief: Brief;
  readonly group: ChangeGroup;
  readonly files: readonly string[];
  readonly span: PrSpan;
  readonly sides: SpanSides;
}

/** Why a group re-looks, and whether the cause was a file whose hunks could not pair. */
interface CarryRefusal {
  readonly reason: string;
  readonly isUnpaired: boolean;
}

function refuseCarry(
  reason: string,
  isUnpaired = false,
): {
  ok: false;
  error: CarryRefusal;
} {
  return { ok: false, error: { reason, isUnpaired } };
}

/** A group carries when the PR's change to each of its files held and every range moves. */
function decideGroupCarry(
  input: GroupCarryInput,
): Result<FrozenCarry, CarryRefusal> {
  const { previousBrief, group, files, span, sides } = input;
  const unchanged = new Set(span.unchangedFiles);
  const changed = files.find((file) => !unchanged.has(file));
  if (changed !== undefined) {
    return refuseCarry(`${changed}: the push changed the PR's change`);
  }
  const unpairable = new Set(span.unpairableFiles);
  const unplaced = files.find((file) => unpairable.has(file));
  if (unplaced !== undefined) {
    return refuseCarry(
      `${unplaced}: no span pairs ${unplaced} across the push`,
      true,
    );
  }
  // Same post-image over a base that took part of the PR's change: unchanged by blob, yet its runs no longer pair.
  const unpaired = files.find(
    (file) => (sides.removed.get(file) ?? []).length === 0,
  );
  if (unpaired !== undefined) {
    return refuseCarry(
      `${unpaired}: no span pairs the PR's change across the push`,
      true,
    );
  }
  const chunks = previousBrief.chunks.filter(
    (chunk) => chunk.changeGroupId === group.id,
  );
  if (chunks.length === 0) {
    return refuseCarry("previous group has no chunks, nothing carriable");
  }

  const moved = moveChunks(chunks, sides);
  if (!moved.ok) {
    return refuseCarry(`range remap ambiguous, ${moved.error}`);
  }
  return { ok: true, value: { group, chunks: moved.value } };
}

interface GroupDecision {
  readonly group: ChangeGroup;
  readonly files: readonly string[];
  carry: Result<FrozenCarry, CarryRefusal>;
}

/** The first file a frozen group shares with a re-looking one, or none. */
function findReLookShare(
  decision: GroupDecision,
  reLookFiles: ReadonlySet<string>,
): string | undefined {
  if (!decision.carry.ok) {
    return undefined;
  }
  return decision.files.find((file) => reLookFiles.has(file));
}

/**
 * A frozen group sharing a file with a re-looking group re-looks too, since
 * the stitch drops generated chunks on a frozen file; repeated until no
 * frozen group shares a file with a re-looking one.
 */
function settleSharedFiles(decisions: readonly GroupDecision[]): void {
  let moved = true;
  while (moved) {
    moved = false;
    const reLookFiles = new Set(
      decisions
        .filter((decision) => !decision.carry.ok)
        .flatMap((decision) => decision.files),
    );
    for (const decision of decisions) {
      const shared = findReLookShare(decision, reLookFiles);
      if (shared !== undefined) {
        decision.carry = refuseCarry(
          `${shared}: shared with a group that re-looks`,
        );
        moved = true;
      }
    }
  }
}

/**
 * A group freezes when the PR's change to every file it owns held across
 * the push and every range of its chunks moves through the span's hops,
 * and no file it owns is shared with a group that re-looks; anything else
 * re-looks. No span re-looks every group.
 */
export function planAnchoredGeneration(args: AnchorPlanArgs): AnchorPlan {
  const { previousBrief, span } = args;
  const chainGroupIds = args.chainGroupIds ?? [];
  if (span === undefined) {
    return allReLook(previousBrief, SPAN_UNREAD_REASON, chainGroupIds);
  }

  const sides = {
    added: indexHop(span.hop),
    removed: indexHop(span.oldSideHop),
  };
  const decisions: GroupDecision[] = previousBrief.changeGroups.map((group) => {
    const files = getGroupFiles(previousBrief, group.id);
    const carry = decideGroupCarry({
      previousBrief,
      group,
      files,
      span,
      sides,
    });
    return { group, files, carry };
  });
  settleSharedFiles(decisions);

  const frozen: FrozenCarry[] = [];
  const frozenFiles = new Set<string>();
  const reLook: ReLookEntry[] = [];
  let hasUnpairedHunks = false;
  for (const { group, files, carry } of decisions) {
    if (!carry.ok) {
      reLook.push({
        id: group.id,
        files: [...files],
        reason: carry.error.reason,
      });
      hasUnpairedHunks ||= carry.error.isUnpaired;
      continue;
    }
    frozen.push(carry.value);
    for (const file of files) {
      frozenFiles.add(file);
    }
  }

  return {
    frozen,
    frozenFiles,
    reLook,
    previousGroupIds: reserveIds(previousBrief, chainGroupIds),
    warnings: hasUnpairedHunks ? [AnchorWarnings.HUNKS_UNPAIRED] : [],
    hunkSpans: span.hop,
  };
}

/**
 * A dropped group's step points at its frozen parent, which may hold a step
 * of its own: the first step naming a group keeps its place, so each group
 * holds one and the order survives final validation, and it reads the
 * group's own `why` when the model wrote one for it.
 */
function dropRepeatedSteps(
  steps: readonly ReadingOrderStep[],
  ownWhy: ReadonlyMap<string, string>,
): ReadingOrderStep[] {
  const seen = new Set<string>();
  const kept: ReadingOrderStep[] = [];
  for (const step of steps) {
    if (seen.has(step.groupId)) {
      continue;
    }
    seen.add(step.groupId);
    kept.push({ ...step, why: ownWhy.get(step.groupId) ?? step.why });
  }
  return kept;
}

/** Each carried group's first step the model wrote under the carried id itself, by id. */
function readOwnWhy(
  order: readonly ReadingOrderStep[],
  carriedIds: ReadonlySet<string>,
): Map<string, string> {
  const ownWhy = new Map<string, string>();
  for (const step of order) {
    const isOwnStep = carriedIds.has(step.groupId) && !ownWhy.has(step.groupId);
    if (isOwnStep) {
      ownWhy.set(step.groupId, step.why);
    }
  }
  return ownWhy;
}

/** Each kept group the model listed under a carried id, by that id, under its descended id. */
function listSlipGroups(
  keptGroups: readonly ChangeGroup[],
  activeFrozen: readonly FrozenCarry[],
  claimedIds: ReadonlySet<string>,
  descended: ReadonlyMap<string, string>,
): Map<string, ChangeGroup> {
  const carriedIds = new Set(activeFrozen.map((carry) => carry.group.id));
  const slips = new Map<string, ChangeGroup>();
  for (const group of keptGroups) {
    const id = descended.get(group.id);
    const isSlip = carriedIds.has(group.id) && !claimedIds.has(group.id);
    if (isSlip && id !== undefined) {
      slips.set(group.id, { ...group, id });
    }
  }
  return slips;
}

/**
 * A reading order over numbering slips, each a frozen id the model also
 * listed, keyed to the group now holding the slip's content. The frozen id's
 * step stays on the carried group and the slip group's step follows it; a
 * slip whose frozen id has no step joins the end under its group's title.
 * Every group then holds one step, so the order survives final validation.
 */
export function insertSlipSteps(
  order: readonly ReadingOrderStep[],
  slips: ReadonlyMap<string, ChangeGroup>,
): ReadingOrderStep[] {
  const steps: ReadingOrderStep[] = [];
  const placed = new Set<string>();
  for (const step of order) {
    steps.push(step);
    const slip = slips.get(step.groupId);
    if (slip !== undefined && !placed.has(step.groupId)) {
      steps.push({ ...step, groupId: slip.id });
      placed.add(step.groupId);
    }
  }
  for (const [frozenId, slip] of slips) {
    if (!placed.has(frozenId)) {
      steps.push({ groupId: slip.id, why: slip.title });
    }
  }
  return steps;
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

/** The first frozen group, other than `id` and not claimed, that carries one of `files`. */
function findCarriedSharer(
  id: string,
  files: ReadonlySet<string>,
  claimedIds: ReadonlySet<string>,
  frozenFilesById: ReadonlyMap<string, ReadonlySet<string>>,
): { sharerId: string; file: string } | undefined {
  for (const [sharerId, sharerFiles] of frozenFilesById) {
    const file = [...files].find((entry) => sharerFiles.has(entry));
    const isCarried = sharerId !== id && !claimedIds.has(sharerId);
    if (isCarried && file !== undefined) {
      return { sharerId, file };
    }
  }
  return undefined;
}

/**
 * Drop each claim whose frozen files another frozen group still carries:
 * the stitch drops generated chunks on a carried file, so releasing the
 * claim would lose its chunks there. The carry stays and the drift goes,
 * as with no claim evidence; repeated until no claim shares a carried file.
 * Answers each refused claim's issue by its group id.
 */
function refuseSharedClaims(
  claimedIds: Set<string>,
  frozenFilesById: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, string> {
  const refusals = new Map<string, string>();
  let refused = true;
  while (refused) {
    refused = false;
    for (const id of claimedIds) {
      const files = frozenFilesById.get(id) ?? new Set<string>();
      const sharer = findCarriedSharer(id, files, claimedIds, frozenFilesById);
      if (sharer !== undefined) {
        claimedIds.delete(id);
        refusals.set(
          id,
          `frozen group ${id} claimed but shares ${sharer.file} with frozen group ${sharer.sharerId}, which stays carried: carry kept, drift discarded`,
        );
        refused = true;
      }
    }
  }
  return refusals;
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
  /** Where each claim's issue goes, so the issues keep the generated groups' order. */
  const claimIssueAt = new Map<string, number>();
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
      claimIssueAt.set(group.id, issues.push("") - 1);
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
  const refusals = refuseSharedClaims(claimedIds, frozenFilesById);
  for (const [id, at] of claimIssueAt) {
    issues[at] =
      refusals.get(id) ??
      `frozen group ${id} claimed by the model output — unfrozen and re-examined`;
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
    const slips = listSlipGroups(
      keptGroups,
      activeFrozen,
      claimedIds,
      descended,
    );
    const mapped = generated.readingOrder.map((step) =>
      slips.has(step.groupId)
        ? step
        : { ...step, groupId: referenceMap.get(step.groupId) ?? step.groupId },
    );
    const ordered = insertSlipSteps(mapped, slips);
    const ownWhy = readOwnWhy(generated.readingOrder, new Set(carriedIds));
    brief.readingOrder = dropRepeatedSteps(ordered, ownWhy);
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
