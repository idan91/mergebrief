import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { parseBriefSearchParams } from "@web/features/brief/model";
import { isDemoBuild } from "@web/utils/demo-build";
import { buildPrMetaQueryOptions } from "../../queries";
import { readExplicitSpan, readRevisionRequest } from "../../search";
import {
  resolveMetaPollMs,
  selectBriefRouteState,
  type BriefRouteState,
} from "../../utils/briefRouteState";
import { resolvePollMs } from "../../utils/poll-backoff";
import { resolveDbTimeline } from "../../utils/dbTimeline";
import type { PrBriefPage, UsePrBriefPageInput } from "./types";
import { useConversationFilterParams } from "./useConversationFilterParams";
import { useRevisionWrites } from "./useRevisionWrites";
import {
  deriveReadOnlyReason,
  deriveRevisionPosture,
  deriveSelectedSpanKey,
} from "./utils";
import { isFocusLost, MAIN_CONTENT_ID } from "@web/utils/main-content";

/**
 * Re-anchors onto the brief only when focus was left nowhere. A pick from
 * the Revisions tab hands focus back to the Sidebar once the next brief is
 * live; this catches what nothing claims. Never scrolls.
 */
function useRescueLostFocus(
  stateKind: BriefRouteState["kind"],
  spanKey: string | undefined,
) {
  useEffect(() => {
    if (!isFocusLost(document.activeElement)) {
      return;
    }
    document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
  }, [stateKind, spanKey]);
}

export function usePrBriefPage({
  repoId,
  prNumber,
  search,
  navigate,
}: UsePrBriefPageInput): PrBriefPage {
  const { t } = useTranslation();
  const meta = useSuspenseQuery({
    ...buildPrMetaQueryOptions(repoId, prNumber),
    refetchInterval: (query) => {
      const loaded = query.state.data;
      if (loaded === undefined) {
        return false;
      }
      return resolvePollMs(query.state, resolveMetaPollMs(loaded));
    },
  }).data;

  const { rev, head, base, view, compare, diff, focus } = search;
  const timeline = useMemo(
    () =>
      resolveDbTimeline(
        meta.revisions,
        readRevisionRequest({ rev, head, base }),
      ),
    [base, head, meta.revisions, rev],
  );
  const explicit = useMemo(
    () => readExplicitSpan({ base, head }),
    [base, head],
  );
  const state = useMemo(
    () =>
      selectBriefRouteState(meta, timeline, { explicitSpan: explicit, rev }),
    [explicit, meta, rev, timeline],
  );

  const renderedHead = state.kind === "render" ? state.span.head : undefined;
  const posture = deriveRevisionPosture(meta, timeline, renderedHead);
  // An inline literal busts every ChunkCard's memo boundary per poll tick.
  const readOnly = useMemo(
    () => deriveReadOnlyReason(t, posture, isDemoBuild()),
    [posture, t],
  );
  const searchParams = useMemo(
    () => parseBriefSearchParams({ view, compare, diff, focus }),
    [compare, diff, focus, view],
  );

  const filter = useConversationFilterParams(search, navigate);
  const writes = useRevisionWrites(search, navigate, timeline);
  useRescueLostFocus(state.kind, deriveSelectedSpanKey(timeline));

  return {
    meta,
    state,
    timeline,
    readOnly,
    staleHead: posture.staleHead,
    searchParams,
    conversationFilter: filter.conversationFilter,
    onConversationFilterChange: filter.onConversationFilterChange,
    conversationFocusThreadId: search.thread,
    onSelectRevision: writes.selectRevision,
    revisionJump: writes.revisionJump,
    onGoToNewest: posture.newerRevisionSelectable
      ? writes.goToNewest
      : undefined,
  };
}
