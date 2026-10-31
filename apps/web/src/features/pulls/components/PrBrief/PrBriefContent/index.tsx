// The rendered-brief composition for the DB route. Data assembly (queries +
// live-diff attach) lives here; plan/transport assembly lives in the
// usePrBriefPlans hook.
import { splitUnifiedDiffByFile } from "brief-core/chunk-layout";
import { useTranslation } from "react-i18next";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  BriefView,
  buildBriefAddress,
  readDiffView,
  useDiffRetryLanding,
  useBriefReading,
  type BriefAddressPort,
  type ConversationCapability,
  type ScopeExitOptions,
} from "@web/features/brief";
import {
  buildBriefSearchParams,
  buildChunkLayoutCounts,
  CompareParams,
  countBriefFiles,
  createFileRowsCache,
  resolveBriefSearch,
  stripDefaultSearch,
  withCompare,
  withView,
  type BriefSearch,
  type BriefSearchParams,
  type ChunkLayoutState,
  type LivePrState,
} from "@web/features/brief/model";
import { createSessionWrites } from "@web/features/review/session";
import type { ThreadRevisionJump } from "@web/features/conversation";
import type { Span } from "../../../utils/briefRouteState";
import { comparisonsWarming } from "../../../utils/briefRouteState";
import {
  buildRevisionTimelineViewFromDb,
  findDbTimelinePoint,
  type DbTimelinePoint,
  type DbTimelineSelection,
} from "../../../utils/dbTimeline";
import { usePrBriefPlans } from "../../../hooks/usePrBriefPlans";
import {
  buildDbBriefContextQueryOptions,
  buildDbBriefLayoutQueryOptions,
  buildDbBriefQueryOptions,
  buildPrDiffQueryOptions,
  buildPrStackQueryOptions,
  buildSessionQueryOptions,
  createSessionReads,
} from "../../../queries";
import type { PrSummary } from "../../../types";
import { useNewerCommits } from "./DbBriefControls/NewerCommitsChip/hooks/useNewerCommits";
import { DbBriefControls } from "./DbBriefControls";
import { WarmingChip } from "../WarmingChip";
import { buildPrReview, findMainContent } from "./utils";
import type { ConversationFilter } from "@web/features/conversation/utils";

export interface PrBriefContentProps {
  repoId: string;
  prNumber: number;
  span: Span;
  meta: PrSummary;
  searchParams: BriefSearchParams;
  /** The route's URL writes. */
  address: BriefAddressPort;
  readOnly?: { reason: string } | undefined;
  /** Head mismatch: writable, Submit gated by the receipt ack. */
  staleHead?: boolean | undefined;
  /** Present only when a newer briefed revision exists to move to. */
  onGoToNewest?: (() => void) | undefined;
  timeline?: DbTimelineSelection | undefined;
  onSelectRevision?: ((point: DbTimelinePoint) => void) | undefined;
  revisionJump?: ThreadRevisionJump | undefined;
  conversationFocusThreadId?: number | undefined;
  /** Reviewer/verdict filter carried in the URL. */
  conversationFilter?: ConversationFilter | undefined;
  onConversationFilterChange: (next: ConversationFilter) => void;
  /** A revision navigation is in flight (router pending); route-owned. */
  revisionPending?: boolean | undefined;
}

export function PrBriefContent({
  repoId,
  prNumber,
  span,
  meta,
  searchParams,
  address: port,
  readOnly,
  staleHead,
  onGoToNewest,
  timeline,
  onSelectRevision,
  revisionJump,
  conversationFocusThreadId,
  conversationFilter,
  onConversationFilterChange,
  revisionPending,
}: PrBriefContentProps) {
  const { t } = useTranslation();
  const newerCommits = useNewerCommits({
    meta,
    repoId,
    prNumber,
    staleHead: staleHead === true,
    onGoToNewest,
  });
  const brief = useSuspenseQuery(
    buildDbBriefQueryOptions(repoId, prNumber, span.base, span.head),
  ).data;
  // Best-effort: while loading or on failure the Brief renders without source
  // markers/de-emphasis.
  const repoConfig = useQuery(
    buildDbBriefContextQueryOptions(repoId, prNumber, span.base, span.head),
  );
  // The live diff arrives client-side and attaches per-chunk rows; while it
  // loads, chunks legally render without a diff (the renderer degrades).
  const fileCount = useMemo(() => countBriefFiles(brief), [brief]);
  const diff = useQuery(
    buildPrDiffQueryOptions(repoId, prNumber, span.base, span.head, fileCount),
  );
  // The worker's per-chunk counts, prefetched by the loader: a diff-less
  // card reserves its height from them until the diff lands. Absent for a
  // brief written without them, and the page keeps its estimate.
  const layout = useQuery(
    buildDbBriefLayoutQueryOptions(repoId, prNumber, span.base, span.head),
  );
  // The Review Session, prefetched by the route loader so the FIRST paint
  // already carries marks, drafts and dispositions. A failed read degrades:
  // the Brief renders, and the screen goes read-only, a reviewer typing into
  // a screen hiding their earlier drafts writes the same comment twice.
  // Every later read reaches the Brief's store through `sessionReads`, which
  // the store's subscription keys on, so its identity holds per span.
  const queryClient = useQueryClient();
  const sessionReads = useMemo(
    () =>
      createSessionReads(queryClient, repoId, prNumber, span.base, span.head),
    [prNumber, queryClient, repoId, span.base, span.head],
  );
  const session = useQuery(
    buildSessionQueryOptions(
      repoId,
      prNumber,
      span.base,
      span.head,
      sessionReads,
    ),
  );
  // One transport per span, so every store action fires exactly one
  // operation against the Brief it was read from.
  const writes = useMemo(
    () =>
      createSessionWrites({
        repoId,
        prNumber,
        base: span.base,
        head: span.head,
      }),
    [prNumber, repoId, span.base, span.head],
  );
  // One parse per file for the page: the cards' slices and the hunk-edge
  // expansion read the same rows, so the cache identity has to hold across
  // renders. The brief itself never changes when the diff lands: each card
  // attaches its own rows through the cache.
  // A failed diff settles as an empty cache, so a line link stops waiting
  // for rows that will not come and lands on its owner's card instead.
  const fileRows = useMemo(() => {
    if (diff.data !== undefined) {
      return createFileRowsCache(splitUnifiedDiffByFile(diff.data));
    }
    return diff.isError ? createFileRowsCache(new Map()) : undefined;
  }, [diff.data, diff.isError]);
  const diffLanding = useDiffRetryLanding(diff, findMainContent);
  const layoutCounts = useMemo(
    () => buildChunkLayoutCounts(layout.data?.body),
    [layout.data?.body],
  );
  const chunkLayout = useMemo<ChunkLayoutState>(
    () => ({ counts: layoutCounts, codePending: fileRows === undefined }),
    [layoutCounts, fileRows],
  );
  const {
    briefId,
    comparisonPlan,
    availability,
    lastReviewDisabledReason,
    submitAction,
    conversationPlan,
    ownDraft,
  } = usePrBriefPlans({ repoId, prNumber, span, meta, timeline, revisionJump });
  const compareState = resolveBriefSearch(searchParams, availability);
  // The stack GitHub has now, or the record for a closed PR, not the one the
  // artifact saw at generation. A failed first read leaves it absent and the
  // header keeps the snapshot; a failed poll keeps the last live stack.
  const liveStack = useQuery(buildPrStackQueryOptions(repoId, prNumber));
  const livePrState: LivePrState = { state: meta.state, draft: meta.draft };
  if (liveStack.data !== undefined) {
    livePrState.stack = liveStack.data;
  }
  // Deps are PRIMITIVES: `availability` and `searchParams` are per-render
  // literals, and this callback rides into GroupCard's memo boundary, which
  // must survive PR-meta poll ticks.
  const searchView = searchParams.view;
  const searchCompare = searchParams.compare;
  const searchDiff = searchParams.diff;
  const previousBriefAvailable = availability.previousBrief;
  const lastReviewAvailable = availability.lastReview;
  const navigateRouteSearch = port.navigateSearch;
  // Every View/Compare write lands through here so a default never reaches
  // the URL; the stored diff preference is read at write time, on the client.
  const navigateSearch = useCallback(
    (next: BriefSearch, options?: ScopeExitOptions) => {
      const flags = {
        previousBrief: previousBriefAvailable,
        lastReview: lastReviewAvailable,
      };
      navigateRouteSearch(
        stripDefaultSearch(
          buildBriefSearchParams(next.view, next.compare, searchDiff),
          flags,
          readDiffView(),
        ),
        options,
      );
    },
    [
      lastReviewAvailable,
      navigateRouteSearch,
      previousBriefAvailable,
      searchDiff,
    ],
  );
  const openComparison = useCallback(() => {
    const flags = {
      previousBrief: previousBriefAvailable,
      lastReview: lastReviewAvailable,
    };
    navigateSearch(
      withCompare(
        resolveBriefSearch(
          buildBriefSearchParams(searchView, searchCompare),
          flags,
        ),
        CompareParams.LAST_REVIEW,
        flags,
      ),
    );
  }, [
    lastReviewAvailable,
    navigateSearch,
    previousBriefAvailable,
    searchCompare,
    searchView,
  ]);
  // Scope-axis exit for the IntentBar's jumps: the same normalized search
  // write the header View control makes, pinned to `full`.
  const exitChangesScope = useCallback(
    (options?: ScopeExitOptions) => {
      const flags = {
        previousBrief: previousBriefAvailable,
        lastReview: lastReviewAvailable,
      };
      navigateSearch(
        withView(
          resolveBriefSearch(
            buildBriefSearchParams(searchView, searchCompare),
            flags,
          ),
          "full",
          flags,
        ),
        options,
      );
    },
    [
      lastReviewAvailable,
      navigateSearch,
      previousBriefAvailable,
      searchCompare,
      searchView,
    ],
  );
  const revisionView = useMemo(
    () =>
      timeline === undefined
        ? undefined
        : buildRevisionTimelineViewFromDb(timeline),
    [timeline],
  );
  const revisions =
    revisionView === undefined ||
    timeline === undefined ||
    onSelectRevision === undefined
      ? undefined
      : {
          view: revisionView,
          selectRevision: (key: string) => {
            const point = findDbTimelinePoint(timeline, key);
            if (point !== undefined) {
              onSelectRevision(point);
            }
          },
        };
  const reading = useBriefReading({
    brief,
    briefId,
    fileRows,
    chunkLayout,
    comparisonPlan,
    repoConfig: repoConfig.data ?? null,
    revisions,
  });
  const address = buildBriefAddress({
    port,
    searchParams,
    exitChangesScope,
    revisionPending: revisionPending === true,
  });
  // A failed BACKGROUND refetch keeps the session that is already rendered,
  // only an absent one closes the screen.
  const review = buildPrReview({
    submitReview: submitAction,
    readOnly,
    staleHead: staleHead === true,
    ownDraft,
    session: session.data,
    sessionReads,
    writes,
    sessionUnavailableReason: t("brief.screen.sessionUnavailable"),
    meta,
  });
  const conversation: ConversationCapability = {
    plan: conversationPlan,
    focusThreadId: conversationFocusThreadId,
    filter: conversationFilter,
    onFilterChange: onConversationFilterChange,
  };
  // Renders in the STICKY header's control slot so the controls are never
  // scrolled out of reach by the selection focus effect.
  const headerControls = (
    <DbBriefControls
      compare={{
        availability,
        compareState,
        lastReviewDisabledReason,
        onNavigate: navigateSearch,
      }}
      note={
        timeline?.degraded ? t("pulls.content.revisionLinkGone") : undefined
      }
      readOnly={review.readOnly !== undefined}
      newerCommits={newerCommits}
    />
  );
  return (
    <>
      {/* Warming is a property of the LATEST generation, never shown while a
          stale or read-only revision is in view (history never polls). */}
      {readOnly === undefined &&
      staleHead !== true &&
      comparisonsWarming(meta) ? (
        <WarmingChip />
      ) : null}
      <p className="sr-only" role="status">
        {diffLanding.announcement}
      </p>
      <BriefView
        reading={reading}
        address={address}
        // Live webhook state, the badge never shows the artifact's stale
        // snapshot.
        pr={{
          livePrState,
          authorLogin: meta.authorLogin,
          repoId,
          openComparison,
          headerControls,
          diffTimeout: diffLanding.retry,
        }}
        review={review}
        conversation={conversation}
      />
    </>
  );
}
