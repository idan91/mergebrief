import { ROW_RUN, ROW_RUN_KIND_BY_LINE_KIND } from "../consts";
import {
  RowRunKinds,
  type RowRun,
  type RowRunKind,
  type ParsedDiffLine,
} from "../types";

const RUN_KINDS: ReadonlySet<string> = new Set(Object.values(RowRunKinds));

/**
 * The slice as runs of one kind, with an expand control's own row a run
 * just before the row index it sits above (the slice's length for one
 * under the last row).
 */
export function encodeRowRuns(
  slice: readonly ParsedDiffLine[],
  expandIndexes: ReadonlySet<number>,
): string {
  const runs: RowRun[] = [];

  for (let index = 0; index <= slice.length; index += 1) {
    if (expandIndexes.has(index)) {
      appendRun(runs, RowRunKinds.EXPAND);
    }
    const row = slice[index];
    if (row !== undefined) {
      appendRun(runs, ROW_RUN_KIND_BY_LINE_KIND[row.kind]);
    }
  }

  return runs.map((run) => `${run.kind}${String(run.length)}`).join("");
}

/** A stored `rowRuns` string's runs, in order. Reads one `CHUNK_ROW_RUNS` already checked. */
export function readRowRuns(rowRuns: string): RowRun[] {
  const runs: RowRun[] = [];

  for (const match of rowRuns.matchAll(ROW_RUN)) {
    const kind = match.groups?.["kind"];
    const length = Number(match.groups?.["length"]);
    if (kind !== undefined && isRowRunKind(kind)) {
      runs.push({ kind, length });
    }
  }

  return runs;
}

function appendRun(runs: RowRun[], kind: RowRunKind): void {
  const last = runs.at(-1);
  if (last?.kind === kind) {
    last.length += 1;
    return;
  }
  runs.push({ kind, length: 1 });
}

function isRowRunKind(value: string): value is RowRunKind {
  return RUN_KINDS.has(value);
}
