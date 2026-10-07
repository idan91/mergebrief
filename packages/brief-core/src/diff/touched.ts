/**
 * Touched-ness predicate: previous-brief groups × incremental-diff evidence →
 * frozen | re-look per group, computed mechanically. Conservative by
 * construction; a group freezes ONLY when every one of its files is positively
 * confirmed untouched by the prevHead→head span. Renames, binary/mode-only
 * changes, unrecognized statuses, and a missing or possibly-truncated compare
 * file list all demote to re-look: wasteful, never wrong.
 */
import type { ValueOf } from "types/utils";
import type { RevisionChangeFile } from "./revchanges";

export const GroupVerdicts = {
  FROZEN: "frozen",
  RE_LOOK: "re-look",
} as const;
export type GroupVerdict = ValueOf<typeof GroupVerdicts>;

/**
 * One entry of the compare endpoint's JSON `files[]` list (new-side path +
 * raw status). `status` is deliberately an OPEN string: the predicate treats
 * every entry as touched regardless of status, so an unknown future value
 * degrades conservatively instead of failing a parse.
 */
export interface CompareFileEntry {
  readonly file: string;
  readonly status: string;
  /** `previous_filename`; present on renamed/copied entries. */
  readonly previousFile?: string;
}

/** A previous brief's group reduced to what the predicate needs. */
export interface PreviousGroupFiles {
  readonly id: string;
  readonly files: readonly string[];
}

export interface PartitionInput {
  readonly previousGroups: readonly PreviousGroupFiles[];
  /** Parsed prevHead→head ranges (files with zero changes drop out upstream). */
  readonly incrementalFiles: readonly RevisionChangeFile[];
  /**
   * The compare endpoint's JSON per-file entries. `undefined` = unavailable
   * (fetch failed / not attempted); nothing is confirmable, everything
   * re-looks.
   */
  readonly compareFiles?: readonly CompareFileEntry[];
  /**
   * False when the compare file list may be truncated (GitHub caps it at
   * 300 files); absence from the list then proves nothing.
   */
  readonly compareComplete?: boolean;
}

export interface GroupPartition {
  readonly id: string;
  readonly verdict: GroupVerdict;
  /** Present exactly on re-look; the first confirming evidence, for logs. */
  readonly reason?: string;
}

/**
 * Partition previous groups into frozen | re-look. Order-stable: one entry
 * per previous group, in input order.
 */
export function partitionGroups(
  input: PartitionInput,
): readonly GroupPartition[] {
  const { previousGroups, incrementalFiles, compareFiles, compareComplete } =
    input;

  if (compareFiles === undefined) {
    return previousGroups.map((group) => ({
      id: group.id,
      verdict: GroupVerdicts.RE_LOOK,
      reason: "compare file metadata unavailable — nothing is confirmable",
    }));
  }
  if (compareComplete !== true) {
    return previousGroups.map((group) => ({
      id: group.id,
      verdict: GroupVerdicts.RE_LOOK,
      reason: "compare file list possibly truncated — nothing is confirmable",
    }));
  }

  // Every path named by ANY evidence source counts as touched: parsed hunks
  // (the raw diff) plus every compare entry; added/removed/modified/renamed/
  // copied/mode-only/binary all appear there, and an unrecognized status is
  // still an entry. Renames/copies touch BOTH sides.
  const touched = new Map<string, string>();
  const touch = (file: string, why: string) => {
    if (!touched.has(file)) {
      touched.set(file, why);
    }
  };
  for (const entry of compareFiles) {
    touch(entry.file, `compare status '${entry.status}'`);
    if (entry.previousFile !== undefined) {
      touch(
        entry.previousFile,
        `compare status '${entry.status}' (previous path of ${entry.file})`,
      );
    }
  }
  for (const file of incrementalFiles) {
    touch(file.file, "incremental diff hunks");
  }

  return previousGroups.map((group) => {
    for (const file of group.files) {
      const why = touched.get(file);
      if (why !== undefined) {
        return {
          id: group.id,
          verdict: GroupVerdicts.RE_LOOK,
          reason: `${file}: ${why}`,
        };
      }
    }
    return { id: group.id, verdict: GroupVerdicts.FROZEN };
  });
}
