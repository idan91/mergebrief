import type { Brief } from "brief-core/types";
import type { PairEvalProperty, RevisionPair } from "../pairs";
import {
  buildSummaryMediaGuards,
  listPointerKeys,
  listShownKeys,
} from "../summary-media-props";

/**
 * Shared pair-property builders: the six stability ↔ completeness property
 * pairs from the spec, expressed as run-stable mechanical facts (files,
 * group relations, attribute names, id carry), never chunk boundaries or
 * free-form text. Each case's expected.ts composes from these; intent
 * properties keyword-match planted markers, a bounded exception.
 */

/** Groups owning at least one chunk in `file`. */
export function groupsOwning(brief: Brief, file: string): string[] {
  const ids = new Set<string>();
  for (const chunk of brief.chunks) {
    if (chunk.file === file) {
      ids.add(chunk.changeGroupId);
    }
  }
  return [...ids];
}

type Chunk = Brief["chunks"][number];
type ChangeGroup = Brief["changeGroups"][number];

/** Canonical JSON of a group definition + its chunks (order-normalized). */
function formatGroupSnapshot(
  group: ChangeGroup | undefined,
  groupChunks: readonly Chunk[],
): string {
  const chunks = groupChunks
    .map((chunk) => ({
      file: chunk.file,
      concern: chunk.concern,
      role: chunk.role,
      loc: chunk.loc,
      addedRanges: chunk.addedRanges,
      removedRanges: chunk.removedRanges,
      riskSurface: [...chunk.riskSurface].toSorted(),
    }))
    .toSorted((a, b) => a.file.localeCompare(b.file));
  return JSON.stringify({ group, chunks });
}

function groupSnapshot(brief: Brief, groupId: string): string {
  const group = brief.changeGroups.find((entry) => entry.id === groupId);
  const chunks = brief.chunks.filter(
    (chunk) => chunk.changeGroupId === groupId,
  );
  return formatGroupSnapshot(group, chunks);
}

/** Union of risk attributes across a file's chunks. */
export function attrsOn(brief: Brief, file: string): Set<string> {
  const attrs = new Set<string>();
  for (const chunk of brief.chunks) {
    if (chunk.file !== file) {
      continue;
    }
    for (const attr of chunk.riskSurface) {
      attrs.add(attr);
    }
  }
  return attrs;
}

/**
 * Spec pair 1 LEFT (mechanical, hard): the group owning `file`, untouched
 * by the increment, survives as the plan carried it: definition and chunks
 * equal to its frozen carry, ranges moved only by the span's hop.
 */
export function untouchedGroupSurvives(file: string): PairEvalProperty {
  return {
    id: `untouched-survives-${file.split("/").at(-1)}`,
    description: `the group owning untouched ${file} survives as carried, its ranges moved only by the span`,
    check: (pair: RevisionPair) => {
      const baseOwners = groupsOwning(pair.base, file);
      const owner = baseOwners[0];
      if (baseOwners.length !== 1 || owner === undefined) {
        return false;
      }
      const carry = pair.plan.frozen.find((entry) => entry.group.id === owner);
      if (carry === undefined) {
        return false;
      }
      return (
        formatGroupSnapshot(carry.group, carry.chunks) ===
        groupSnapshot(pair.revised, owner)
      );
    },
  };
}

/**
 * Spec pair 5 LEFT (mechanical, hard): a frozen group's attribute set never
 * changes across the revision.
 */
export function frozenAttrsNeverChange(file: string): PairEvalProperty {
  return {
    id: `frozen-attrs-stable-${file.split("/").at(-1)}`,
    description: `risk attributes on untouched ${file} are identical across revisions`,
    check: (pair: RevisionPair) => {
      const before = [...attrsOn(pair.base, file)].toSorted();
      const after = [...attrsOn(pair.revised, file)].toSorted();
      return JSON.stringify(before) === JSON.stringify(after);
    },
  };
}

/**
 * A file the revised Brief splits across groups the base split it across
 * too, every one of them carried: the carry kept the base's split.
 */
function isCarriedSplit(
  pair: RevisionPair,
  owners: readonly string[],
  file: string,
): boolean {
  const carriedIds = new Set(pair.plan.frozen.map((carry) => carry.group.id));
  const baseOwners = groupsOwning(pair.base, file).toSorted();
  const isBaseSplit =
    JSON.stringify(baseOwners) === JSON.stringify(owners.toSorted());
  return isBaseSplit && owners.every((id) => carriedIds.has(id));
}

/**
 * Coverage (mechanical, hard): every named file in exactly one revised
 * group, or in the groups the base split it across when the plan carried
 * each of them.
 */
export function coverage(files: readonly string[]): PairEvalProperty {
  return {
    id: "coverage-exactly-one-group",
    description:
      "every PR file lands in exactly one revised group, or in the carried groups the base split it across",
    check: (pair: RevisionPair) =>
      files.every((file) => {
        const owners = groupsOwning(pair.revised, file);
        if (owners.length === 1) {
          return true;
        }
        return owners.length > 1 && isCarriedSplit(pair, owners, file);
      }),
  };
}

/** Id carry (mechanical under descent): the revised owner of `file` keeps the base group id. */
export function idCarried(file: string): PairEvalProperty {
  return {
    id: `id-carried-${file.split("/").at(-1)}`,
    description: `the group owning ${file} keeps its id across the revision`,
    check: (pair: RevisionPair) => {
      const before = groupsOwning(pair.base, file);
      const after = groupsOwning(pair.revised, file);
      return (
        before.length === 1 && after.length === 1 && before[0] === after[0]
      );
    },
  };
}

/** The revised brief is stamped anchored with the expected carried set shape. */
export function anchoredStamp(expectCarried: boolean): PairEvalProperty {
  return {
    id: "anchored-stamp",
    description: expectCarried
      ? "revised brief is anchored and carried at least one group"
      : "revised brief is anchored with an empty carried set",
    check: (pair: RevisionPair) => {
      if (pair.revised.anchor?.state !== "anchored") {
        return false;
      }
      const carried = pair.revised.anchoring?.carried ?? [];
      return expectCarried ? carried.length > 0 : carried.length === 0;
    },
  };
}

function chunkOrderKey(chunk: { file: string; addedRanges: unknown }): string {
  return JSON.stringify([chunk.file, chunk.addedRanges]);
}

/**
 * Spec pair 6 LEFT (mechanical): the surviving (carried) chunks of an
 * untouched file keep their relative order in the revised brief; the
 * stitch appends carried chunks in previous order.
 */
export function survivorOrderStable(file: string): PairEvalProperty {
  return {
    id: `survivor-order-stable-${file.split("/").at(-1)}`,
    description: `chunks of untouched ${file} keep their relative order across revisions`,
    check: (pair: RevisionPair) => {
      const before = pair.base.chunks
        .filter((chunk) => chunk.file === file)
        .map(chunkOrderKey);
      const after = pair.revised.chunks
        .filter((chunk) => chunk.file === file)
        .map(chunkOrderKey);
      return (
        before.length > 0 && JSON.stringify(before) === JSON.stringify(after)
      );
    },
  };
}

/** No group re-looks: the span changed nothing, so the plan carries every base group. */
export function carriesEveryGroup(): PairEvalProperty {
  return {
    id: "carries-every-group",
    description: "an unchanged span carries every base group and re-looks none",
    check: (pair: RevisionPair) =>
      pair.plan.reLook.length === 0 &&
      pair.plan.frozen.length === pair.base.changeGroups.length,
  };
}

/** Every base group with a chunk in a changed file re-looks; none of them is carried. */
export function reLooksOwnersOf(files: readonly string[]): PairEvalProperty {
  return {
    id: "re-looks-changed-owners",
    description: `every group owning ${files.join(", ")} re-looks`,
    check: (pair: RevisionPair) => {
      const reLookIds = new Set(pair.plan.reLook.map((entry) => entry.id));
      const owners = files.flatMap((file) => groupsOwning(pair.base, file));
      return owners.length > 0 && owners.every((id) => reLookIds.has(id));
    },
  };
}

/** Every carried group reaches the revised brief as carried: its chunks only moved by the span. */
export function keepsCarriedGroups(): PairEvalProperty {
  return {
    id: "carried-groups-survive",
    description:
      "at least one group carries and every carry survives in the revised brief as carried",
    check: (pair: RevisionPair) =>
      pair.plan.frozen.length > 0 &&
      pair.plan.frozen.every(
        (carry) =>
          formatGroupSnapshot(carry.group, carry.chunks) ===
          groupSnapshot(pair.revised, carry.group.id),
      ),
  };
}

function formatShiftedRanges(
  ranges: readonly { start: number; end: number }[],
  lines: number,
): string {
  const shifted = ranges.map((range) => ({
    start: range.start + lines,
    end: range.end + lines,
  }));
  return JSON.stringify(shifted);
}

/**
 * A base edit above every PR run in `file` moved them `lines` down: each
 * carried chunk on the file sits that much lower, never on its old lines.
 */
export function shiftsCarriedRanges(
  file: string,
  lines: number,
): PairEvalProperty {
  return {
    id: `carried-ranges-shift-${file.split("/").at(-1)}`,
    description: `chunks carried on ${file} moved ${lines} lines down with the base edit above them`,
    check: (pair: RevisionPair) => {
      const baseChunks = pair.base.chunks.filter(
        (chunk) => chunk.file === file,
      );
      const carried = pair.plan.frozen
        .flatMap((carry) => carry.chunks)
        .filter((chunk) => chunk.file === file);
      const moved = carried.every((chunk) => {
        const before = baseChunks.find((entry) => entry.id === chunk.id);
        const expected = formatShiftedRanges(before?.addedRanges ?? [], lines);
        return (
          before !== undefined && JSON.stringify(chunk.addedRanges) === expected
        );
      });
      return carried.length > 0 && moved;
    },
  };
}

/** The no-call carry keeps the base brief's Summary Media exactly as stored. */
export function summaryMediaCarried(): PairEvalProperty {
  return {
    id: "summary-media-carried",
    description:
      "the revised brief keeps the base brief's Summary Media as stored",
    check: (pair: RevisionPair) =>
      pair.base.summaryMedia !== undefined &&
      JSON.stringify(pair.base.summaryMedia) ===
        JSON.stringify(pair.revised.summaryMedia),
  };
}

/** The Summary Media call after the stitch showed or pointed at an item. */
export function summaryMediaPicked(): PairEvalProperty {
  return {
    id: "summary-media-picked",
    description:
      "the revised brief's Summary Media call showed or pointed at a description item",
    check: (pair: RevisionPair) => {
      const picked = [
        ...listShownKeys(pair.revised),
        ...listPointerKeys(pair.revised),
      ];
      return picked.length > 0;
    },
  };
}

/** The Summary Media generator guarantees, held by the revised brief. */
export function revisedSummaryMediaGuards(): PairEvalProperty[] {
  return buildSummaryMediaGuards().map((guard) => ({
    id: guard.id,
    description: `revised brief: ${guard.description}`,
    check: (pair: RevisionPair) => guard.check(pair.revised),
  }));
}

/** The revised inputs differ from the base brief's, so no carry may skip the model. */
export function inputFingerprintMoved(): PairEvalProperty {
  return {
    id: "input-fingerprint-moved",
    description:
      "the revised brief's input fingerprint differs from the base brief's",
    check: (pair: RevisionPair) => {
      const { inputFingerprint: before } = pair.base;
      const { inputFingerprint: after } = pair.revised;
      return before !== undefined && after !== undefined && before !== after;
    },
  };
}
