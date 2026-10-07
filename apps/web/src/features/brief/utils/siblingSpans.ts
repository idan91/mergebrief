import {
  type DiffLine,
  DiffLineKinds,
  DiffRowOrigins,
} from "@web/utils/diffTokens/types";

/** Row indexes, inclusive, of one owner's expanded changed rows and the context between them. */
export interface SiblingSpan {
  start: number;
  end: number;
  owner: string;
}

export type LineOwnerResolver = (line: DiffLine) => string | undefined;

/**
 * Consecutive expanded rows that belong to another chunk, grouped by owner.
 * A span runs from one owner's first expanded changed row to its last;
 * expanded context between two of them stays inside, context before or
 * after stays out, and any row the chunk itself carries ends the span.
 */
export function groupSiblingSpans(
  rows: readonly DiffLine[],
  ownerOf: LineOwnerResolver,
): SiblingSpan[] {
  const spans: SiblingSpan[] = [];
  let open: SiblingSpan | undefined;

  rows.forEach((row, index) => {
    if (row.origin !== DiffRowOrigins.EXPANDED) {
      open = undefined;
      return;
    }
    const changed =
      row.kind === DiffLineKinds.ADD || row.kind === DiffLineKinds.DEL;
    if (!changed) {
      return;
    }
    const owner = ownerOf(row);
    if (owner === undefined) {
      open = undefined;
      return;
    }
    if (open !== undefined && open.owner === owner) {
      open.end = index;
      return;
    }
    open = { start: index, end: index, owner };
    spans.push(open);
  });

  return spans;
}
