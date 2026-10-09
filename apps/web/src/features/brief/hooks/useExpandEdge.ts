import type { LineRange } from "brief-core/types";
import { useState } from "react";

import {
  FileRangeResultKinds,
  type ExpandableEdge,
  type ExpanderStep,
  type FileRangeResultKind,
} from "../types";
import { resolveExpanderStep } from "../utils/expansionState";
import { isExpansionCovered } from "../utils/expansion-rows";
import { useFileRangeReader } from "./useFileRange";
import { useExpansionSource } from "./useExpansionSource";
import { useExpansionActions } from "./useExpansion";
import { useFileRows } from "./useFileRows";

/** Why an edge cannot expand; the file-range read's refusals, curated. */
export type ExpandFailure = Exclude<
  FileRangeResultKind,
  typeof FileRangeResultKinds.READY
>;

export interface UseExpandEdgeInput {
  edge: ExpandableEdge;
  path: string;
}

export interface ExpandEdgeControl {
  /** The next click's read, or undefined when the edge is spent. */
  step: ExpanderStep | undefined;
  busy: boolean;
  failure: ExpandFailure | undefined;
  /** Reads the next range and records it; resolves when the rows can land. */
  expand: () => Promise<boolean>;
}

/**
 * One edge's click: read the range the step names, then record it so the
 * spliced rows pick the lines up from the query cache. A refusal sticks to
 * the control, never the live region: the reader is looking right at it.
 */
export function useExpandEdge(input: UseExpandEdgeInput): ExpandEdgeControl {
  const { edge, path } = input;
  const source = useExpansionSource();
  const fileRows = useFileRows()?.getFileRows(path);
  const readRange = useFileRangeReader(source, path);
  const { expandEdge } = useExpansionActions();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ExpandFailure | undefined>(undefined);
  const step = resolveExpanderStep(edge);

  // The note from a failed read stays up through the retry it invites and
  // clears only on a result: a click never blanks it into a silent wait.
  async function expand(): Promise<boolean> {
    if (step === undefined || busy) {
      return false;
    }
    // The diff already holds every line of this range: nothing to read.
    if (fileRows !== undefined && isExpansionCovered(fileRows, step.range)) {
      const range: LineRange = {
        start: step.range.from,
        end: step.range.to,
      };
      expandEdge(edge.edgeKey, range, undefined, path);
      setFailure(undefined);
      return true;
    }
    setBusy(true);
    try {
      const result = await readRange({
        start: step.range.from,
        end: step.range.to,
      });
      if (result === undefined) {
        return false;
      }
      if (result.kind !== FileRangeResultKinds.READY) {
        setFailure(result.kind);
        return false;
      }
      // An empty range (from = totalLines + 1) records no line and still
      // pins the file end, which is what spends the edge.
      const read: LineRange = {
        start: result.range.from,
        end: result.range.to,
      };
      expandEdge(edge.edgeKey, read, result.range.totalLines, path);
      setFailure(undefined);
      return true;
    } catch (error) {
      // A thrown read (5xx, network, malformed body) is the same "not now".
      console.error(error);
      setFailure(FileRangeResultKinds.UNAVAILABLE);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { step, busy, failure, expand };
}
