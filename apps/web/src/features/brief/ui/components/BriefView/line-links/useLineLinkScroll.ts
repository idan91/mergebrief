import { ExpansionDirections } from "brief-core/chunk-layout";
import type { LineRange } from "brief-core/types";
import { useQueryClient } from "@tanstack/react-query";
import { RequestBounds } from "contract";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LineLinkTarget, LineSelection } from "@web/features/review/utils";
import type { ReviewFlowActions } from "@web/features/review/session";
import type { ExpansionActions } from "../../../../model/expansion/useExpansion";
import type { ExpansionSource } from "../../../../model/expansion/useExpansionSource";
import { fetchFileRange } from "../../../../model/expansion/useFileRange";
import { type BriefChunk } from "../../../../model/types";
import { FileRangeResultKinds } from "../../../../model/expansion/types";
import { isExpansionCovered } from "../../../../model/expansion/rows";
import type { FileRowsCache } from "../../../../model/file-rows/cache";
import { AddressEventKinds, type AddressHandle } from "../address/types";
import {
  ScrollHistories,
  type JumpToChunkFromConversation,
} from "../scroll-to-target/types";
import { collectSelectionRowIds, planLineLink } from "./line-link-plan";
import {
  type LineLinkPlan,
  LineLinkPlanKinds,
  type LineLinkRead,
  type LineReadOutcome,
  LineReadOutcomes,
} from "../types";

export interface UseLineLinkScrollInput {
  briefId: string;
  /** Every chunk a card shows, the unattributed remainder included. */
  chunks: readonly BriefChunk[];
  fileRows: FileRowsCache | undefined;
  /** The PR diff has answered, with rows or without. */
  rowsSettled: boolean;
  expansionSource: ExpansionSource | undefined;
  /** Scrolls by replace: an arrival in Changes scope leaves it without a history step. */
  jumpToChunkFromConversation: JumpToChunkFromConversation;
  selectLines: ReviewFlowActions["selectLines"];
  expandEdge: ExpansionActions["expandEdge"];
  announce: (message: string) => void;
  /** The selection itself is on the page, so it is announced without a toast. */
  announceQuietly: (message: string) => void;
  /** A miss drops the link through it. */
  address: Pick<AddressHandle, "send">;
  t: TFunction;
}

export interface LineLinkScroll {
  /** True when the link's one chance is spent, false to keep it. */
  scrollToLine: (target: LineLinkTarget) => boolean;
  missed: boolean;
  dismissMiss: () => void;
}

type RowTargetPlan = Extract<
  LineLinkPlan,
  { kind: typeof LineLinkPlanKinds.ROW }
>;

const MAIN_CONTENT_ID = "main-content";

function buildSelection(
  plan: RowTargetPlan,
  target: LineLinkTarget,
): LineSelection {
  const selection: LineSelection = {
    chunkId: target.chunkId,
    file: plan.chunk.file,
    side: target.side,
    startLine: target.startLine,
    endLine: target.endLine,
    rowIds: collectSelectionRowIds(plan.chunk, target),
  };
  if (target.startSide !== undefined) {
    selection.startSide = target.startSide;
  }

  return selection;
}

/** The read in cap-sized steps, the edge's own step first. */
function splitReadRange(read: LineLinkRead): LineRange[] {
  const steps: LineRange[] = [];
  const { start, end } = read.range;
  if (read.direction === ExpansionDirections.UP) {
    for (let to = end; to >= start; to -= RequestBounds.FILE_RANGE_LINES) {
      steps.push({
        start: Math.max(start, to - RequestBounds.FILE_RANGE_LINES + 1),
        end: to,
      });
    }
    return steps;
  }
  for (let from = start; from <= end; from += RequestBounds.FILE_RANGE_LINES) {
    steps.push({
      start: from,
      end: Math.min(end, from + RequestBounds.FILE_RANGE_LINES - 1),
    });
  }
  return steps;
}

/**
 * Scrolls to a line link: the chunk's card mounts through the conversation
 * scroll, a folded line reads its hunk edge first, and the range becomes
 * the selection, so the link the reader arrived on is the one the page
 * would write. A miss drops the link and says so; a read the source could
 * not serve keeps the link and shows the chunk instead. The read runs before
 * the scroll, so one scroll carries the final target out of Changes scope.
 */
export function useLineLinkScroll(
  input: UseLineLinkScrollInput,
): LineLinkScroll {
  const {
    briefId,
    chunks,
    fileRows,
    rowsSettled,
    expansionSource,
    jumpToChunkFromConversation,
    selectLines,
    expandEdge,
    announce,
    announceQuietly,
    address,
    t,
  } = input;
  const queryClient = useQueryClient();
  const [missedFor, setMissedFor] = useState<string | undefined>();
  // A read that settles after the brief moved on must not act on the new
  // brief's rows, nor navigate from a page that is gone.
  const liveBriefId = useRef(briefId);
  liveBriefId.current = briefId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The screen outlives a revision switch; a miss belongs to the brief it
  // happened on and is gone once the reader leaves it.
  useEffect(() => {
    setMissedFor((current) => (current === briefId ? current : undefined));
  }, [briefId]);

  const miss = useCallback(() => {
    setMissedFor(liveBriefId.current);
    address.send({ kind: AddressEventKinds.LINE_LINK_MISSED });
    announce(t("brief.lineLink.missing"));
  }, [address, announce, t]);

  const readStep = useCallback(
    async (path: string, read: LineLinkRead, step: LineRange) => {
      try {
        const result = await fetchFileRange(
          queryClient,
          expansionSource,
          path,
          step,
        );
        if (result?.kind !== FileRangeResultKinds.READY) {
          return LineReadOutcomes.UNAVAILABLE;
        }
        // The source clamps to the file's end: a line past it is not there.
        if (result.range.end < step.end) {
          return LineReadOutcomes.SHORT;
        }
        expandEdge(read.edgeKey, result.range, result.totalLines, path);
        return LineReadOutcomes.LANDED;
      } catch (error) {
        console.error(error);
        return LineReadOutcomes.UNAVAILABLE;
      }
    },
    [expandEdge, expansionSource, queryClient],
  );

  const readIntoEdge = useCallback(
    async (path: string, read: LineLinkRead): Promise<LineReadOutcome> => {
      const known = fileRows?.getFileRows(path);
      const alreadyCovered =
        known !== undefined && isExpansionCovered(known, read.range);
      if (alreadyCovered) {
        expandEdge(read.edgeKey, read.range, undefined, path);
        return LineReadOutcomes.LANDED;
      }
      for (const step of splitReadRange(read)) {
        const outcome = await readStep(path, read, step);
        if (outcome !== LineReadOutcomes.LANDED) {
          return outcome;
        }
      }
      return LineReadOutcomes.LANDED;
    },
    [expandEdge, fileRows, readStep],
  );

  const scrollToCard = useCallback(
    (chunk: BriefChunk): boolean => {
      const scheduled = jumpToChunkFromConversation(
        chunk.id,
        undefined,
        "instant",
        ScrollHistories.REPLACE,
      );
      if (scheduled) {
        announce(t("brief.lineLink.readFailed"));
      }
      return scheduled;
    },
    [announce, jumpToChunkFromConversation, t],
  );

  const scrollToLines = useCallback(
    (plan: RowTargetPlan, target: LineLinkTarget): boolean => {
      const scheduled = jumpToChunkFromConversation(
        plan.chunk.id,
        plan.row,
        "instant",
        ScrollHistories.REPLACE,
      );
      if (!scheduled) {
        return false;
      }

      selectLines(buildSelection(plan, target));
      announceQuietly(
        target.startLine === target.endLine
          ? t("review.announce.lineSelected", { line: target.startLine })
          : t("review.announce.linesSelected", {
              start: target.startLine,
              end: target.endLine,
            }),
      );
      return true;
    },
    [announceQuietly, jumpToChunkFromConversation, selectLines, t],
  );

  const readThenScroll = useCallback(
    async (
      plan: RowTargetPlan,
      read: LineLinkRead,
      target: LineLinkTarget,
    ): Promise<void> => {
      const started = liveBriefId.current;
      const outcome = await readIntoEdge(plan.chunk.file, read);
      const stale = !mounted.current || liveBriefId.current !== started;
      if (stale) {
        return;
      }

      if (outcome === LineReadOutcomes.SHORT) {
        miss();
        return;
      }
      const scrollsToCard =
        outcome === LineReadOutcomes.UNAVAILABLE && read.coversStart;
      if (scrollsToCard) {
        scrollToCard(plan.chunk);
        return;
      }
      scrollToLines(plan, target);
    },
    [scrollToCard, scrollToLines, miss, readIntoEdge],
  );

  const scrollToLine = useCallback(
    (target: LineLinkTarget): boolean => {
      const plan = planLineLink(chunks, target, rowsSettled);
      if (plan.kind === LineLinkPlanKinds.PENDING) {
        return false;
      }
      if (plan.kind === LineLinkPlanKinds.MISS) {
        miss();
        return true;
      }
      if (plan.kind === LineLinkPlanKinds.CARD) {
        return scrollToCard(plan.chunk);
      }
      if (plan.read === undefined) {
        return scrollToLines(plan, target);
      }

      void readThenScroll(plan, plan.read, target);
      return true;
    },
    [chunks, scrollToCard, scrollToLines, miss, readThenScroll, rowsSettled],
  );

  // Dismiss unmounts the button under focus; the page's main landmark
  // takes it so Tab does not restart at the top.
  const dismissMiss = useCallback(() => {
    setMissedFor(undefined);
    document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
  }, []);

  return { scrollToLine, missed: missedFor === briefId, dismissMiss };
}
