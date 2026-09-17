import { useState } from "react";

import { useReviewActions } from "@web/features/review/session";
import type { ExpandableEdge, ExpanderStep, LineRange } from "../types";
import { resolveExpanderStep } from "../utils/expansionState";
import type { FileRangeResult } from "../queries";
import { isWindowCovered } from "../utils/fileWindowRows";
import { useFileRangeReader } from "./useFileRange";
import { useExpansionSource } from "./useExpansionSource";
import { useFileRows } from "./useFileRows";

/** Why an edge cannot expand; the file-range read's refusals, curated. */
export type ExpandFailure = Exclude<FileRangeResult["kind"], "ready">;

export interface UseExpandEdgeInput {
  edge: ExpandableEdge;
  path: string;
}

export interface ExpandEdgeControl {
  /** The next click's read, or undefined when the edge is spent. */
  step: ExpanderStep | undefined;
  busy: boolean;
  failure: ExpandFailure | undefined;
  /** Reads the next window and records it; resolves when the rows can land. */
  expand: () => Promise<boolean>;
}

/**
 * One edge's click: read the window the step names, then record it so the
 * spliced rows pick the lines up from the query cache. A refusal sticks to
 * the control, never the live region: the reader is looking right at it.
 */
export function useExpandEdge(input: UseExpandEdgeInput): ExpandEdgeControl {
  const { edge, path } = input;
  const source = useExpansionSource();
  const fileRows = useFileRows()?.getFileRows(path);
  const readWindow = useFileRangeReader(source, path);
  const { expandEdge } = useReviewActions();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ExpandFailure | undefined>(undefined);
  const step = resolveExpanderStep(edge);

  // The note from a failed read stays up through the retry it invites and
  // clears only on a result: a click never blanks it into a silent wait.
  async function expand(): Promise<boolean> {
    if (step === undefined || busy) return false;
    // The diff already holds every line of this window: nothing to read.
    if (fileRows !== undefined && isWindowCovered(fileRows, step.window)) {
      const window: LineRange = {
        start: step.window.from,
        end: step.window.to,
      };
      expandEdge(edge.edgeKey, window, undefined, path);
      setFailure(undefined);
      return true;
    }
    setBusy(true);
    try {
      const result = await readWindow({
        start: step.window.from,
        end: step.window.to,
      });
      if (result === undefined) return false;
      if (result.kind !== "ready") {
        setFailure(result.kind);
        return false;
      }
      // An empty window (from = totalLines + 1) records no line and still
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
      setFailure("unavailable");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { step, busy, failure, expand };
}
