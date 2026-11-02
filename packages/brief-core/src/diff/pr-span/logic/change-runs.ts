import { HUNK_HEADER } from "../../chunk-layout/consts";
import { NO_NEWLINE_MARKER } from "../consts";
import type { ChangeRun, PatchHunks } from "../types";

interface RunDraft {
  lines: string[];
  hunk: number;
  oldStart: number;
  newStart: number;
  removed: number;
  added: number;
}

interface WalkCursor {
  oldLine: number;
  newLine: number;
  hunk: number;
  run?: RunDraft | undefined;
}

/** A side with no lines (`+4,0`) names the line before; the walk counts from the line after it. */
export function readSideStart(
  start: string | undefined,
  count: string | undefined,
): number {
  const line = Number(start);
  return count === "0" ? line + 1 : line;
}

function openRun(cursor: WalkCursor): RunDraft {
  if (cursor.run !== undefined) {
    return cursor.run;
  }
  const run: RunDraft = {
    lines: [],
    hunk: cursor.hunk,
    oldStart: cursor.oldLine,
    newStart: cursor.newLine,
    removed: 0,
    added: 0,
  };
  cursor.run = run;
  return run;
}

function closeRun(cursor: WalkCursor, runs: ChangeRun[]): void {
  if (cursor.run !== undefined) {
    runs.push(cursor.run);
    cursor.run = undefined;
  }
}

function walkBodyLine(
  cursor: WalkCursor,
  line: string,
  runs: ChangeRun[],
): void {
  const marker = line[0];
  if (marker === "+") {
    const run = openRun(cursor);
    run.lines.push(line);
    run.added += 1;
    cursor.newLine += 1;
    return;
  }
  if (marker === "-") {
    const run = openRun(cursor);
    run.lines.push(line);
    run.removed += 1;
    cursor.oldLine += 1;
    return;
  }
  if (marker === NO_NEWLINE_MARKER) {
    cursor.run?.lines.push(line);
    return;
  }
  closeRun(cursor, runs);
  cursor.oldLine += 1;
  cursor.newLine += 1;
}

/**
 * Every change run of one file's patch, in order. Numbering follows
 * `parsePatchRows`: an empty line advances neither side.
 */
export function readChangeRuns(patch: string): ChangeRun[] {
  const runs: ChangeRun[] = [];
  const cursor: WalkCursor = { oldLine: 0, newLine: 0, hunk: -1 };

  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      closeRun(cursor, runs);
      const sides = header.groups ?? {};
      cursor.oldLine = readSideStart(sides["oldStart"], sides["oldCount"]);
      cursor.newLine = readSideStart(sides["newStart"], sides["newCount"]);
      cursor.hunk += 1;
      continue;
    }
    if (cursor.hunk >= 0 && line !== "") {
      walkBodyLine(cursor, line, runs);
    }
  }
  closeRun(cursor, runs);
  return runs;
}

/** A patch cut at its hunk headers: the lines before the first, then each hunk's lines. */
export function splitPatchHunks(patch: string): PatchHunks {
  const header: string[] = [];
  const hunks: string[][] = [];
  for (const line of patch.split("\n")) {
    if (HUNK_HEADER.test(line)) {
      hunks.push([line]);
      continue;
    }
    const current = hunks.at(-1);
    if (current === undefined) {
      header.push(line);
    } else {
      current.push(line);
    }
  }
  return { header, hunks };
}

/** True when two run lists hold the same `+`/`-` content run by run. */
export function hasSameRuns(
  left: readonly ChangeRun[],
  right: readonly ChangeRun[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((run, index) => {
    const other = right[index];
    const sameLength =
      other !== undefined && other.lines.length === run.lines.length;
    return (
      sameLength && run.lines.every((line, at) => line === other.lines[at])
    );
  });
}
