import type { DiffLine } from "@web/utils/diffTokens/types";
import { useMemo } from "react";

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
import { isExpansionCovered } from "../utils/expansion-rows";
import { useFileRange } from "./useFileRange";
import { useExpansionSource } from "./useExpansionSource";
import { useExpansion } from "./useExpansion";
import { useFileRows } from "./useFileRows";

export interface UseExpandedRowsInput {
  chunkId: string;
  path: string;
  rows: readonly DiffLine[];
}

export interface ExpandedRows {
  rows: DiffLine[];
  /** For each row, its index in the base rows, or -1 for an expanded one. */
  baseIndexOf: number[];
  edges: ExpandableEdge[];
  /** Names the expansion state; undefined when nothing is expanded. */
  expansionKey: string | undefined;
}

const NO_RANGES: LineRange[] = [];
const NO_EDGES: ExpandableEdge[] = [];

/**
 * A chunk's rows with every edge the reader expanded spliced in. The
 * expansion store holds which lines each edge took; the query cache holds
 * the lines.
 */
export function useExpandedRows(input: UseExpandedRowsInput): ExpandedRows {
  const { chunkId, path, rows } = input;
  const source = useExpansionSource();
  const fileRows = useFileRows()?.getFileRows(path);
  const expandedEdges = useExpansion((state) => state.expandedEdges);
  const fileEnd = useExpansion((state) => state.fileEnds.get(path));
  // A file the diff creates or removes shows every line it has. An expanded
  // row paints as unchanged context with an old-side number, which such a
  // file cannot have, so the chunk offers no edge at all, gaps included.
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
  // A range the file's own diff covers end to end needs no read.
  const ranges = useMemo(
    () =>
      stored.length === 0
        ? NO_RANGES
        : stored
            .flatMap((edge) => edge.expansion.ranges)
            .filter(
              (range) =>
                fileRows === undefined ||
                !isExpansionCovered(fileRows, {
                  from: range.start,
                  to: range.end,
                }),
            ),
    [stored, fileRows],
  );
  const lines = useFileRange({ source, path, ranges });

  return useMemo(() => {
    const spliced =
      stored.length === 0
        ? [...rows]
        : spliceStoredEdges({
            rows,
            edges: stored,
            lines,
            fileRows,
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
    fileRows,
    source,
    chunkId,
    baseGaps,
    expandedEdges,
    expansionKey,
    wholeFile,
    fileEnd,
  ]);
}
