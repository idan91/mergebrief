/**
 * Row walk of one file's unified patch: every line inside a hunk with its
 * numbers on the sides it exists on. An added row has a new line only, a
 * removed row an old line only, context both. The changed-range parser and
 * the range snap both number lines through this one walk, so they can never
 * disagree by a line.
 */
export interface PatchRow {
  content: string;
  oldLine?: number;
  newLine?: number;
  /** Position of the row's hunk in the patch, from zero. */
  hunk: number;
  /** The patch line the row came from, from zero. */
  patchLine: number;
}

export const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatchRows(patch: string): PatchRow[] {
  const rows: PatchRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let hunk = -1;
  for (const [patchLine, line] of patch.split("\n").entries()) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk += 1;
      continue;
    }
    // Only lines inside a hunk count, so the `---`/`+++`/`diff --git`
    // header lines, which begin with the same markers, are skipped. An
    // empty line is not a blank context line (a stripped-whitespace
    // patch loses the leading space) and advances neither side, as the
    // changed-range parser always read it. A `\ No newline at end of
    // file` line advances neither side either.
    if (hunk < 0 || line === "" || line.startsWith("\\")) {
      continue;
    }
    const marker = line[0];
    const content = line.slice(1);
    if (marker === "+") {
      rows.push({ content, newLine, hunk, patchLine });
      newLine += 1;
    } else if (marker === "-") {
      rows.push({ content, oldLine, hunk, patchLine });
      oldLine += 1;
    } else {
      rows.push({ content, oldLine, newLine, hunk, patchLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return rows;
}

export function isAddedRow(row: PatchRow): boolean {
  return row.newLine !== undefined && row.oldLine === undefined;
}

export function isRemovedRow(row: PatchRow): boolean {
  return row.oldLine !== undefined && row.newLine === undefined;
}
