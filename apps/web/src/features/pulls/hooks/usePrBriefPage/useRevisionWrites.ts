import { useCallback, useEffect, useMemo } from "react";

import type { NavigateSearch } from "@web/features/brief";
import { buildPrSearch } from "../../search";
import type { PrBriefSearch } from "../../search/types";
import type {
  DbTimelinePoint,
  DbTimelineSelection,
} from "../../utils/dbTimeline";
import type { RevisionWrites } from "./types";
import {
  buildRevisionSpansKey,
  findJumpRevision,
  parseRevisionSpansKey,
  readPinnedRev,
  shouldPinRev,
} from "./utils";

/**
 * The revision moves. A jump target (`thread`, `l`) is spent once a
 * revision is chosen, and a legacy span never survives a write. A revision
 * is a lateral move, so no scroll reset.
 */
export function useRevisionWrites(
  search: PrBriefSearch,
  navigate: NavigateSearch<PrBriefSearch>,
  timeline: DbTimelineSelection | undefined,
): RevisionWrites {
  const goToNewest = useCallback(() => {
    void navigate({
      search: (previous) =>
        buildPrSearch(previous, {
          rev: undefined,
          head: undefined,
          base: undefined,
          thread: undefined,
          l: undefined,
        }),
      replace: false,
      resetScroll: false,
    });
  }, [navigate]);

  const selectRevision = useCallback(
    (point: DbTimelinePoint) => {
      void navigate({
        search: (previous) =>
          buildPrSearch(previous, {
            rev: point.headIndex,
            head: undefined,
            base: undefined,
            thread: undefined,
            l: undefined,
          }),
        replace: false,
        resetScroll: false,
      });
    },
    [navigate],
  );

  const spansKey = buildRevisionSpansKey(timeline);
  const revisionJump = useMemo(() => {
    if (spansKey === undefined) {
      return undefined;
    }
    const spans = parseRevisionSpansKey(spansKey);

    return {
      knownHeads: new Set(spans.map((span) => span.headSha)),
      onJump: (anchorSha: string, threadId: number) => {
        const rev = findJumpRevision(spans, anchorSha);
        void navigate({
          search: (previous) =>
            buildPrSearch(previous, {
              rev,
              head: undefined,
              base: undefined,
              l: undefined,
              thread: threadId,
            }),
          replace: false,
        });
      },
    };
  }, [navigate, spansKey]);

  usePinnedRev(search, navigate, readPinnedRev(timeline));

  return { goToNewest, selectRevision, revisionJump };
}

/**
 * Pins the selected revision into the URL: a bare or legacy-span link is
 * rewritten to its `rev`, replacing the entry. A degraded request stays as
 * the reviewer followed it; the page shows latest with a note.
 */
function usePinnedRev(
  search: PrBriefSearch,
  navigate: NavigateSearch<PrBriefSearch>,
  pinnedRev: number | undefined,
): void {
  const { rev, head, base } = search;

  useEffect(() => {
    if (!shouldPinRev({ rev, head, base }, pinnedRev)) {
      return;
    }
    void navigate({
      search: (previous) =>
        buildPrSearch(previous, {
          rev: pinnedRev,
          head: undefined,
          base: undefined,
        }),
      replace: true,
    });
  }, [base, head, navigate, pinnedRev, rev]);
}
