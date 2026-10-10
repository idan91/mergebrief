import type { LineRange } from "brief-core/types";
import type { DiffLine } from "@web/utils/diffTokens/types";
import { useMemo } from "react";

import type { ExpandableEdge, RowRef } from "./types";
import { findExpansionGaps } from "./gaps";
import { resolveFileStatus } from "../utils/fileStatus";
import {
  buildExpansionKey,
  collectStoredEdges,
  mapRowRefs,
  placeExpandableEdges,
  spliceStoredEdges,
} from "./edges";
import { isExpansionCovered } from "./rows";
import { useFileRange } from "./useFileRange";
import { useExpansionSource } from "./useExpansionSource";
import { useExpansion } from "./useExpansion";
import { useFileRows } from "../file-rows/useFileRows";

export interface UseExpandedRowsInput {
  chunkId: string;
  path: string;
  rows: readonly DiffLine[];
}

export interface ExpandedRows {
  rows: DiffLine[];
  /** For each row, the base row it is or that it is expanded context. */
  rowRefs: RowRef[];
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
            .filter((range) => {
              const needsRead =
                fileRows === undefined || !isExpansionCovered(fileRows, range);
              return needsRead;
            }),
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
      rowRefs: mapRowRefs(rows, spliced),
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
