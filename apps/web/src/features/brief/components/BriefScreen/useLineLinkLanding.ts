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
import { collectSelectionRowIds, planLineLanding } from "./line-landing";
import {
  type LineLandingPlan,
  LineLandingKinds,
  type LineLandingRead,
  type LineReadOutcome,
  LineReadOutcomes,
  type ScopeExitOptions,
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
  inChangesScope: boolean;
  exitChangesScope: ((options?: ScopeExitOptions) => void) | undefined;
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

interface PendingLanding {
  plan: LandPlan;
  target: LineLinkTarget;
}

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
 * not serve keeps the link and shows the chunk instead.
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
    inChangesScope,
    exitChangesScope,
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
  const [missed, setMissed] = useState(false);
  const [pending, setPending] = useState<PendingLanding | undefined>();
  const [seenBriefId, setSeenBriefId] = useState(briefId);
  if (seenBriefId !== briefId) {
    setSeenBriefId(briefId);
    setPending(undefined);
    setMissed(false);
  }
  // A read that settles after the brief moved on must not act on the new
  // brief's rows.
  const liveBriefId = useRef(briefId);
  liveBriefId.current = briefId;

  const miss = useCallback(() => {
    setMissed(true);
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
    (chunk: BriefChunk) => {
      jumpToChunkFromConversation(chunk.id, undefined, "instant");
      announce(t("brief.lineLink.readFailed"));
    },
    [announce, jumpToChunkFromConversation, t],
  );

  const perform = useCallback(
    async (plan: LandPlan, target: LineLinkTarget): Promise<void> => {
      const started = liveBriefId.current;
      if (plan.read !== undefined) {
        const outcome = await readIntoEdge(plan.chunk.file, plan.read);
        if (liveBriefId.current !== started) {
          return;
        }
        if (outcome === LineReadOutcomes.SHORT) {
          miss();
          return;
        }
        if (outcome === LineReadOutcomes.UNAVAILABLE && plan.read.coversStart) {
          landOnCard(plan.chunk);
          return;
        }
      }
      jumpToChunkFromConversation(plan.chunk.id, plan.row, "instant");
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
    },
    [
      announceQuietly,
      jumpToChunkFromConversation,
      landOnCard,
      miss,
      readIntoEdge,
      selectLines,
      t,
      writtenLink,
    ],
  );

  // A landing parked by an arrival in Changes scope, run once the story
  // pane renders.
  useEffect(() => {
    if (pending === undefined || inChangesScope) {
      return;
    }
    setPending(undefined);
    void perform(pending.plan, pending.target);
  }, [inChangesScope, pending, perform]);

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
        landOnCard(plan.chunk);
        return true;
      }
      if (!inChangesScope) {
        void perform(plan, target);
        return true;
      }
      if (exitChangesScope === undefined) {
        return false;
      }
      setPending({ plan, target });
      exitChangesScope({ replace: true });
      return true;
    },
    [
      chunks,
      exitChangesScope,
      inChangesScope,
      landOnCard,
      miss,
      perform,
      rowsSettled,
    ],
  );

  // Dismiss unmounts the button under focus; the page's main landmark
  // takes it so Tab does not restart at the top.
  const dismissMiss = useCallback(() => {
    setMissed(false);
    document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
  }, []);

  return { landLine, missed, dismissMiss };
}
