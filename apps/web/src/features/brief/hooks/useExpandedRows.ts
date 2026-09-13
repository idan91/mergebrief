import type { DiffLine } from "@web/utils/diffTokens/types";
import { useMemo } from "react";

import { useReviewFlow } from "@web/features/review/session";
import type { ExpandableEdge, LineRange } from "../types";
import { findExpansionGaps } from "../utils/expandRows";
import { resolveFileStatus } from "../utils/fileStatus";
import {
  buildExpansionKey,
  collectStoredEdges,
  mapBaseIndexes,
  placeExpandableEdges,
  spliceStoredEdges,
} from "../utils/expansionState";
import { useFileRange } from "./useFileRange";
import { useExpansionSource } from "./useExpansionSource";

export interface UseExpandedRowsInput {
  chunkId: string;
  path: string;
  rows: readonly DiffLine[];
  /** Head-file lines other chunks of this file render; expansion stops there. */
  claimed: readonly LineRange[];
}

export interface ExpandedRows {
  rows: DiffLine[];
  /** For each row, its index in the base rows, or -1 for an expanded one. */
  baseIndexOf: number[];
  edges: ExpandableEdge[];
  /** Names the expansion state; undefined when nothing is expanded. */
  expansionKey: string | undefined;
}

const NO_WINDOWS: LineRange[] = [];
const NO_EDGES: ExpandableEdge[] = [];

/**
 * A chunk's rows with every edge the reader expanded spliced in. The flow
 * store holds which lines each edge took; the query cache holds the lines.
 */
export function useExpandedRows(input: UseExpandedRowsInput): ExpandedRows {
  const { chunkId, path, rows, claimed } = input;
  const source = useExpansionSource();
  const expandedEdges = useReviewFlow((state) => state.expandedEdges);
  const fileEnd = useReviewFlow((state) => state.fileEnds.get(path));
  // A file the diff creates or removes shows every line it has. An expanded
  // row paints as unchanged context with an old-side number, which such a
  // file cannot have, so the chunk offers no edge at all, holes included.
  const wholeFile = useMemo(
    () => resolveFileStatus(rows) !== undefined,
    [rows],
  );
  const baseGaps = useMemo(() => findExpansionGaps(rows), [rows]);
  const stored = useMemo(
    () => collectStoredEdges(chunkId, baseGaps, expandedEdges),
    [chunkId, baseGaps, expandedEdges],
  );
  const expansionKey = buildExpansionKey(stored);
  const windows = useMemo(
    () =>
      stored.length === 0
        ? NO_WINDOWS
        : stored.flatMap((edge) => edge.expansion.windows),
    [stored],
  );
  const lines = useFileRange({ source, path, windows });

  return useMemo(() => {
    const spliced =
      stored.length === 0
        ? [...rows]
        : spliceStoredEdges({
            rows,
            edges: stored,
            lines,
            claimed,
          });
    const edges =
      source === undefined || wholeFile
        ? NO_EDGES
        : placeExpandableEdges(
            chunkId,
            baseGaps,
            findExpansionGaps(spliced),
            expandedEdges,
            fileEnd,
          );

    return {
      rows: spliced,
      baseIndexOf: mapBaseIndexes(rows, spliced),
      edges,
      expansionKey,
    };
  }, [
    stored,
    rows,
    lines,
    claimed,
    source,
    chunkId,
    baseGaps,
    expandedEdges,
    expansionKey,
    wholeFile,
    fileEnd,
  ]);
}
