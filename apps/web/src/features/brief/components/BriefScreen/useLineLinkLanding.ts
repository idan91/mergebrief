import type { LineRange } from "brief-core/types";
import { useQueryClient } from "@tanstack/react-query";
import { MAX_FILE_RANGE_LINES } from "contract";
import type { TFunction } from "i18next";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { LineLinkTarget, LineSelection } from "@web/features/review/utils";
import type { ReviewFlowActions } from "@web/features/review/session";
import type { ExpansionActions } from "../../hooks/useExpansion";
import type { ExpansionSource } from "../../hooks/useExpansionSource";
import { buildFileRangeQueryOptions, isFileRangeReadable } from "../../queries";
import {
  type BriefChunk,
  ExpansionDirections,
  FileRangeResultKinds,
} from "../../types";
import { isExpansionCovered } from "../../utils/expansion-rows";
import type { FileRowsCache } from "../../utils/fileRows";
import { LandHistories } from "./landing/types";
import { collectSelectionRowIds, planLineLanding } from "./line-landing";
import {
  type LineLandingPlan,
  LineLandingKinds,
  type LineLandingRead,
  type LineReadOutcome,
  LineReadOutcomes,
} from "./types";
import type { JumpToChunkFromConversation } from "./useConversationWiring/types";
import { deriveLineLink } from "./utils";

export interface UseLineLinkLandingInput {
  briefId: string;
  /** Every chunk a card shows, the unattributed remainder included. */
  chunks: readonly BriefChunk[];
  fileRows: FileRowsCache | undefined;
  /** The PR diff has answered, with rows or without. */
  rowsSettled: boolean;
  expansionSource: ExpansionSource | undefined;
  /** Lands by replace: an arrival in Changes scope leaves it without a history step. */
  jumpToChunkFromConversation: JumpToChunkFromConversation;
  selectLines: ReviewFlowActions["selectLines"];
  expandEdge: ExpansionActions["expandEdge"];
  announce: (message: string) => void;
  /** The selection itself is on the page, so it is announced without a toast. */
  announceQuietly: (message: string) => void;
  navigateLink: ((link: string | undefined) => void) | undefined;
  /** Shared with the link sync: a landed link is the page's own now. */
  writtenLink: RefObject<string | undefined>;
  t: TFunction;
}

export interface LineLinkLanding {
  /** True when the link's one chance is spent, false to keep it. */
  landLine: (target: LineLinkTarget) => boolean;
  missed: boolean;
  dismissMiss: () => void;
}

type LandPlan = Extract<
  LineLandingPlan,
  { kind: typeof LineLandingKinds.LAND }
>;

const MAIN_CONTENT_ID = "main-content";

function buildSelection(plan: LandPlan, target: LineLinkTarget): LineSelection {
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
function splitReadRange(read: LineLandingRead): LineRange[] {
  const steps: LineRange[] = [];
  const { start, end } = read.range;
  if (read.direction === ExpansionDirections.UP) {
    for (let to = end; to >= start; to -= MAX_FILE_RANGE_LINES) {
      steps.push({
        start: Math.max(start, to - MAX_FILE_RANGE_LINES + 1),
        end: to,
      });
    }
    return steps;
  }
  for (let from = start; from <= end; from += MAX_FILE_RANGE_LINES) {
    steps.push({
      start: from,
      end: Math.min(end, from + MAX_FILE_RANGE_LINES - 1),
    });
  }
  return steps;
}

/**
 * Lands a line link: the chunk's card mounts through the conversation
 * landing, a folded line reads its hunk edge first, and the range becomes
 * the selection, so the link the reader arrived on is the one the page
 * would write. A miss drops the link and says so; a read the source could
 * not serve keeps the link and shows the chunk instead. The read runs before
 * the landing, so one landing carries the final target out of Changes scope.
 */
export function useLineLinkLanding(
  input: UseLineLinkLandingInput,
): LineLinkLanding {
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
    navigateLink,
    writtenLink,
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
    writtenLink.current = undefined;
    navigateLink?.(undefined);
    announce(t("brief.lineLink.missing"));
  }, [announce, navigateLink, t, writtenLink]);

  const readStep = useCallback(
    async (path: string, read: LineLandingRead, step: LineRange) => {
      if (expansionSource === undefined) {
        return LineReadOutcomes.UNAVAILABLE;
      }
      const params = {
        ...expansionSource,
        path,
        from: step.start,
        to: step.end,
      };
      if (!isFileRangeReadable(params)) {
        return LineReadOutcomes.UNAVAILABLE;
      }
      try {
        const result = await queryClient.fetchQuery(
          buildFileRangeQueryOptions(params),
        );
        if (result.kind !== FileRangeResultKinds.READY) {
          return LineReadOutcomes.UNAVAILABLE;
        }
        // The source clamps to the file's end: a line past it is not there.
        if (result.range.to < step.end) {
          return LineReadOutcomes.SHORT;
        }
        expandEdge(
          read.edgeKey,
          { start: result.range.from, end: result.range.to },
          result.range.totalLines,
          path,
        );
        return LineReadOutcomes.LANDED;
      } catch (error) {
        console.error(error);
        return LineReadOutcomes.UNAVAILABLE;
      }
    },
    [expandEdge, expansionSource, queryClient],
  );

  const readIntoEdge = useCallback(
    async (path: string, read: LineLandingRead): Promise<LineReadOutcome> => {
      const known = fileRows?.getFileRows(path);
      const whole = { from: read.range.start, to: read.range.end };
      if (known !== undefined && isExpansionCovered(known, whole)) {
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

  const landOnCard = useCallback(
    (chunk: BriefChunk): boolean => {
      const scheduled = jumpToChunkFromConversation(
        chunk.id,
        undefined,
        "instant",
        LandHistories.REPLACE,
      );
      if (scheduled) {
        announce(t("brief.lineLink.readFailed"));
      }
      return scheduled;
    },
    [announce, jumpToChunkFromConversation, t],
  );

  const landOnLines = useCallback(
    (plan: LandPlan, target: LineLinkTarget): boolean => {
      const scheduled = jumpToChunkFromConversation(
        plan.chunk.id,
        plan.row,
        "instant",
        LandHistories.REPLACE,
      );
      if (!scheduled) {
        return false;
      }

      writtenLink.current = deriveLineLink(target);
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
    [announceQuietly, jumpToChunkFromConversation, selectLines, t, writtenLink],
  );

  const readThenLand = useCallback(
    async (
      plan: LandPlan,
      read: LineLandingRead,
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
      if (outcome === LineReadOutcomes.UNAVAILABLE && read.coversStart) {
        landOnCard(plan.chunk);
        return;
      }
      landOnLines(plan, target);
    },
    [landOnCard, landOnLines, miss, readIntoEdge],
  );

  const landLine = useCallback(
    (target: LineLinkTarget): boolean => {
      const plan = planLineLanding(chunks, target, rowsSettled);
      if (plan.kind === LineLandingKinds.PENDING) {
        return false;
      }
      if (plan.kind === LineLandingKinds.MISS) {
        miss();
        return true;
      }
      if (plan.kind === LineLandingKinds.CARD) {
        return landOnCard(plan.chunk);
      }
      if (plan.read === undefined) {
        return landOnLines(plan, target);
      }

      void readThenLand(plan, plan.read, target);
      return true;
    },
    [chunks, landOnCard, landOnLines, miss, readThenLand, rowsSettled],
  );

  // Dismiss unmounts the button under focus; the page's main landmark
  // takes it so Tab does not restart at the top.
  const dismissMiss = useCallback(() => {
    setMissedFor(undefined);
    document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
  }, []);

  return { landLine, missed: missedFor === briefId, dismissMiss };
}
