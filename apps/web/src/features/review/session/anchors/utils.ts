import type { BriefChunk, BriefViewModel } from "@web/features/brief/model";
import type { DiffLine } from "@web/utils/diffTokens/types";
import { rowId } from "../../utils/comments";
import { resolveChunkForLine } from "../../utils/chunk-for-line";
import type { RiskEvidence } from "../../utils/state";
import type { SessionLineDraftComment } from "../serverState";
import type { CoveredRow, DraftRows } from "./types";
import type { DiffSide } from "types/comments";

export function collectChunks(model: BriefViewModel): BriefChunk[] {
  return model.groups.flatMap((group) => group.chunks);
}

/** The ref a stored evidence row carries: the kind decides which field. */
export function getEvidenceRef(evidence: RiskEvidence): string {
  if (evidence.kind === "linked-comment") {
    return evidence.commentId ?? "";
  }
  if (evidence.kind === "chunk-reviewed") {
    return evidence.chunkId ?? "";
  }
  return evidence.note ?? "";
}

function getLineOnSide(row: DiffLine, side: DiffSide): number | undefined {
  return side === "old" ? row.oldLine : row.newLine;
}

export function resolveDraftChunk(
  chunks: readonly BriefChunk[],
  draft: SessionLineDraftComment,
): BriefChunk | undefined {
  return resolveChunkForLine(
    chunks,
    draft.filePath,
    draft.startSide ?? draft.side,
    draft.startLine,
  );
}

/** Same-side: every row whose line on the draft's side is inside the range. */
function collectSameSideRows(
  rows: readonly DiffLine[],
  draft: SessionLineDraftComment,
): CoveredRow[] {
  const covered: CoveredRow[] = [];

  for (const [index, row] of rows.entries()) {
    const line = getLineOnSide(row, draft.side);
    if (line === undefined) {
      continue;
    }
    if (line < draft.startLine || line > draft.endLine) {
      continue;
    }
    covered.push({ index, content: row.content });
  }

  return covered;
}

/**
 * Cross-side: the contiguous render span from the start anchor to the end
 * anchor. Cross-side line numbers are not comparable, but the render order
 * is one sequence, so the span is positional.
 */
function collectCrossSideRows(
  rows: readonly DiffLine[],
  draft: SessionLineDraftComment,
  startSide: DiffSide,
): CoveredRow[] {
  const startIndex = rows.findIndex(
    (row) => getLineOnSide(row, startSide) === draft.startLine,
  );
  const endIndex = rows.findLastIndex(
    (row) => getLineOnSide(row, draft.side) === draft.endLine,
  );
  const unresolved = startIndex === -1 || endIndex === -1;
  if (unresolved || endIndex < startIndex) {
    return [];
  }

  const covered: CoveredRow[] = [];

  for (let index = startIndex; index <= endIndex; index++) {
    const row = rows[index];
    if (row === undefined) {
      continue;
    }
    // Hunk headers and notes carry no line on either side; a span crossing a
    // hunk boundary must not sweep them into the comment.
    if (row.oldLine === undefined && row.newLine === undefined) {
      continue;
    }
    covered.push({ index, content: row.content });
  }

  return covered;
}

/**
 * Rebuild row indexes from the diff; only GitHub coordinates are durable on the wire.
 * Empty rows are normal before the DB-path diff attaches; rendering uses coordinates.
 */
export function collectDraftRows(
  chunk: BriefChunk,
  draft: SessionLineDraftComment,
): DraftRows {
  const rows = chunk.diff ?? [];
  const startSide = draft.startSide ?? draft.side;

  const covered =
    startSide === draft.side
      ? collectSameSideRows(rows, draft)
      : collectCrossSideRows(rows, draft, startSide);

  return {
    rowIds: covered.map((row) => rowId(chunk.id, row.index)),
    selectedText: covered.map((row) => row.content).join("\n"),
  };
}
