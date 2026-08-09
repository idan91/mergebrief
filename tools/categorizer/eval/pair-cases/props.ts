import type { Brief } from "brief-core/types";
import type { PairEvalProperty, RevisionPair } from "../pairs";

/**
 * Shared pair-property builders (BRIEF-143 PR 5): the six stability ↔
 * completeness property pairs from the spec, expressed as run-stable
 * mechanical facts (files, group relations, attribute names, id carry) —
 * never chunk boundaries or free-form text. Each case's expected.ts composes
 * from these; intent properties keyword-match planted markers per the
 * BRIEF-54 bounded exception.
 */

/** Groups owning at least one chunk in `file`. */
export function groupsOwning(brief: Brief, file: string): string[] {
  const ids = new Set<string>();
  for (const chunk of brief.chunks) {
    if (chunk.file === file) ids.add(chunk.changeGroupId);
  }
  return [...ids];
}

/** Canonical JSON of a group definition + its chunks (order-normalized). */
function groupSnapshot(brief: Brief, groupId: string): string {
  const group = brief.changeGroups.find((entry) => entry.id === groupId);
  const chunks = brief.chunks
    .filter((chunk) => chunk.changeGroupId === groupId)
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

/** Union of risk attributes across a file's chunks. */
export function attrsOn(brief: Brief, file: string): Set<string> {
  const attrs = new Set<string>();
  for (const chunk of brief.chunks) {
    if (chunk.file !== file) continue;
    for (const attr of chunk.riskSurface) attrs.add(attr);
  }
  return attrs;
}

/**
 * Spec pair 1 LEFT (mechanical, hard): the group owning `file` — untouched
 * by the increment — survives byte-identical (definition AND chunks,
 * ranges correctly remapped, which for an untouched file means identical).
 */
export function untouchedGroupSurvives(file: string): PairEvalProperty {
  return {
    id: `untouched-survives-${file.split("/").at(-1)}`,
    description: `the group owning untouched ${file} survives byte-identical`,
    check: (pair: RevisionPair) => {
      const baseOwners = groupsOwning(pair.base, file);
      if (baseOwners.length !== 1) return false;
      const owner = baseOwners[0];
      if (owner === undefined) return false;
      return (
        groupSnapshot(pair.base, owner) === groupSnapshot(pair.revised, owner)
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

/** Coverage (mechanical, hard): every named file in exactly one revised group. */
export function coverage(files: readonly string[]): PairEvalProperty {
  return {
    id: "coverage-exactly-one-group",
    description: "every PR file lands in exactly one revised group",
    check: (pair: RevisionPair) =>
      files.every((file) => groupsOwning(pair.revised, file).length === 1),
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
      if (pair.revised.anchor?.state !== "anchored") return false;
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
 * untouched file keep their relative order in the revised brief — the
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
