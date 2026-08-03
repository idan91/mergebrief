// The DB-backed brief route (BRIEF-19): the deep-link target PR comments
// point at. Loader SSR-prefetches exactly what the link names (PR-meta + the
// brief when the span is known — hybrid strategy); the heavy/dynamic rest
// (live diff, status polling) is client-side. The wait UX is the pure
// `briefRouteState` machine; render trigger = artifact EXISTS (ADR 0006
// #10), status only flavors the wait. Composition only: the body switch,
// state cards, and plan assembly live in `features/pulls`.
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { ApiError, ApiErrorKind } from "../data/apiFetch";
import {
  parseCompareParam,
  parseViewParam,
  type BriefSearchParams,
} from "../features/brief/comparison/compareState";
import {
  deriveBriefRouteState,
  headAdvanced,
  shouldPollMeta,
  type Span,
} from "../features/pulls/utils/briefRouteState";
import {
  HeadAdvancedBanner,
  PrBriefBody,
  PrBriefError,
} from "@web/features/pulls";
import {
  dbBriefQueryOptions,
  prMetaQueryOptions,
} from "../features/pulls/queries";
import {
  resolveDbTimeline,
  type DbTimelinePoint,
} from "../features/pulls/utils/dbTimeline";
import { useUnsavedComposerBlocker } from "@web/hooks/useUnsavedComposerGuard";

/** 3–5s window per the plan; one lightweight PR-meta read per tick. */
const META_POLL_MS = 4000;

interface PrBriefSearch extends BriefSearchParams {
  base?: string;
  head?: string;
  /**
   * The outdated-thread jump target (BRIEF-24/25 handoff): the thread's
   * databaseId. This route owns head navigation and reserves the param;
   * the conversation section reads it to open/flash the thread.
   */
  thread?: number;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Both-or-neither: a lone base/head cannot address a span (fallback path). */
function spanFromSearch(search: PrBriefSearch): Span | undefined {
  return search.base !== undefined && search.head !== undefined
    ? { base: search.base, head: search.head }
    : undefined;
}

/** A positive-int thread databaseId, or undefined. */
function parseThreadParam(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePrNumber(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw notFound();
  return value;
}

function assertRepoId(raw: string): string {
  if (!/^\d+$/.test(raw)) throw notFound();
  return raw;
}

/** A read-API NOT_FOUND (the artifact/PR does not exist for this viewer). */
function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === ApiErrorKind.NOT_FOUND;
}

/**
 * Loader error mapping: an unauthenticated read sends the viewer to login; a
 * missing PR/brief becomes the router's 404 (a real HTTP 404 on SSR, not a
 * 500). Everything else propagates to the error component.
 */
function mapLoaderError(error: unknown): never {
  if (error instanceof ApiError && error.kind === ApiErrorKind.UNAUTHORIZED) {
    throw redirect({ href: "/api/auth/github" });
  }
  if (isNotFoundError(error)) {
    throw notFound();
  }
  throw error;
}

export const Route = createFileRoute("/repos/$repoId/pulls/$prNumber")({
  validateSearch: (search: Record<string, unknown>): PrBriefSearch => {
    const base = search["base"];
    const head = search["head"];
    // `head` is the revision-selection key (BRIEF-24): kept on its own so a
    // `?head=<sha>` deep link (e.g. an outdated-thread jump) selects a
    // revision — its base is resolved from `revisions[]`, never the URL. A
    // lone `base` still cannot address anything, so it is kept only alongside
    // a head (the pinned convenience of a full span); an unknown head degrades
    // to latest downstream rather than 404ing a stale link.
    const view = parseViewParam(search["view"]);
    const compare = parseCompareParam(search["compare"]);
    const thread = parseThreadParam(search["thread"]);
    return {
      ...(nonEmpty(head) ? { head } : {}),
      ...(nonEmpty(head) && nonEmpty(base) ? { base } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(compare !== undefined ? { compare } : {}),
      ...(thread !== undefined ? { thread } : {}),
    };
  },
  loaderDeps: ({ search }) => ({
    ...(search.base === undefined ? {} : { base: search.base }),
    ...(search.head === undefined ? {} : { head: search.head }),
  }),
  loader: async ({ context, params, deps }) => {
    const repoId = assertRepoId(params.repoId);
    const prNumber = parsePrNumber(params.prNumber);
    const explicit = spanFromSearch(deps);
    try {
      if (explicit !== undefined) {
        // Deep link with a span: meta + brief in parallel — no waterfall. But
        // while the PR's first Brief is still generating, the Entry-comment
        // "Brief is generating…" link names a span whose artifact 404s; that
        // must NOT 404 the page — the component renders the same diff-first
        // wait state a span-unknown load produces (deriveBriefRouteState
        // degrades the current-span-while-generating case). So swallow ONLY a
        // brief-query NOT_FOUND here; a missing PR (meta NOT_FOUND) is still a
        // real 404, and any other brief failure still propagates.
        const [metaResult, briefResult] = await Promise.allSettled([
          context.queryClient.ensureQueryData(
            prMetaQueryOptions(repoId, prNumber),
          ),
          context.queryClient.ensureQueryData(
            dbBriefQueryOptions(repoId, prNumber, explicit.base, explicit.head),
          ),
        ]);
        if (metaResult.status === "rejected") {
          mapLoaderError(metaResult.reason);
        }
        if (briefResult.status === "rejected") {
          if (!isNotFoundError(briefResult.reason)) {
            mapLoaderError(briefResult.reason);
          }
          // The brief 404s while the PR's first Brief is still generating —
          // swallowed above so the page shows the wait state. But
          // `ensureQueryData` has already written an ERROR entry into the brief
          // query cache, and `dbBriefQueryOptions` is retry:false +
          // staleTime Infinity: when the poll flips `briefAvailable` and the
          // render-state `useSuspenseQuery` mounts, it would THROW that cached
          // error instead of refetching (a hard error boundary until a manual
          // reload). Drop the errored entry so the first render fetches fresh.
          context.queryClient.removeQueries({
            queryKey: dbBriefQueryOptions(
              repoId,
              prNumber,
              explicit.base,
              explicit.head,
            ).queryKey,
            exact: true,
          });
        }
        return;
      }
      // Span unknown: the meta names it, then the brief prefetches only when
      // it is actually renderable (a wait state needs nothing else).
      const meta = await context.queryClient.ensureQueryData(
        prMetaQueryOptions(repoId, prNumber),
      );
      // A `?head=` deep link (or a fresh link on a multi-revision PR) resolves
      // through the timeline: prefetch the SELECTED revision's brief with ITS
      // OWN base (`deps.base` disambiguates duplicate-head rows), so a
      // historical head SSRs correctly. An unknown head degrades to latest
      // here too — never a 404.
      const timeline = resolveDbTimeline(meta.revisions, deps.head, deps.base);
      if (timeline !== undefined) {
        await context.queryClient.ensureQueryData(
          dbBriefQueryOptions(
            repoId,
            prNumber,
            timeline.selected.baseSha,
            timeline.selected.headSha,
          ),
        );
        return;
      }
      const state = deriveBriefRouteState(meta, undefined);
      if (state.kind === "render") {
        await context.queryClient.ensureQueryData(
          dbBriefQueryOptions(
            repoId,
            prNumber,
            state.span.base,
            state.span.head,
          ),
        );
      }
    } catch (error) {
      mapLoaderError(error);
    }
  },
  component: PrBriefRoute,
  errorComponent: PrBriefError,
});

/**
 * The one remaining hard read-only reason (BRIEF-127 narrowed ADR 0019 #6):
 * a superseded BASE renders a diff that is not the PR's current one, so line
 * anchors can land wrong or nowhere on GitHub — write-safety, not staleness.
 * Head-mismatch staleness is writable with a submit ack instead.
 */
const BASE_DRIFT_REASON =
  "This brief was generated against a superseded base of the pull request. Switch to the latest revision to comment or submit a review.";

function PrBriefRoute() {
  // Navigation guard (BRIEF-56): in-app navigation and hard unloads
  // confirm while any composer on this screen holds never-saved text.
  // Route-level so BriefScreen itself stays renderable without a router.
  useUnsavedComposerBlocker();
  const params = Route.useParams();
  const repoId = params.repoId;
  const prNumber = parsePrNumber(params.prNumber);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Memoized on the primitives: `state`/`pinnedSpan` identity chains hang off
  // this object, and a fresh literal per render re-runs the span-pinning
  // effect whenever ?base=&head= are present.
  const explicit = useMemo(
    () =>
      search.base !== undefined && search.head !== undefined
        ? { base: search.base, head: search.head }
        : undefined,
    [search.base, search.head],
  );

  const meta = useSuspenseQuery({
    ...prMetaQueryOptions(repoId, prNumber),
    refetchInterval: (query) =>
      query.state.data !== undefined && shouldPollMeta(query.state.data)
        ? META_POLL_MS
        : false,
  }).data;

  // BRIEF-24: a briefed PR exposes a revision timeline; `?head=` (+ `base`,
  // which disambiguates duplicate-head rows from a retarget re-brief) selects
  // a point (unknown head degrades to latest — never a 404). Absent → the
  // legacy explicit-span / current-head flow is unchanged (metas without
  // revisions).
  const timeline = useMemo(
    () => resolveDbTimeline(meta.revisions, search.head, search.base),
    [meta.revisions, search.base, search.head],
  );

  const state = useMemo(
    () =>
      timeline !== undefined
        ? ({
            kind: "render",
            span: {
              base: timeline.selected.baseSha,
              head: timeline.selected.headSha,
            },
          } as const)
        : deriveBriefRouteState(meta, explicit),
    [explicit, meta, timeline],
  );

  // Write posture (ADR 0019 #6 as amended by BRIEF-127). The submit route
  // pins commit_id to the viewed head and comment anchors are read against
  // the RENDERED (base…head) diff, so two distinct stale shapes exist:
  // - HEAD mismatch (historical revision, or the PR head advanced past the
  //   newest brief): GitHub accepts a review pinned to the older head and
  //   marks its comments outdated — writable, but Submit requires an
  //   explicit ack (`staleHead`, consumed by the ReceiptDrawer).
  // - BASE mismatch (same head, retarget re-brief against a superseded
  //   base): the rendered diff is not the PR's current one, so anchors can
  //   land wrong or nowhere — stays hard read-only.
  // `meta.baseSha` is comparable here: with `briefAvailable` it is the latest
  // brief row's own base (`buildPrView`), the same row `revisions[]` ends
  // with; a null meta base (defensive) cannot veto.
  // Derived as primitives so the memo below survives poll ticks (each meta
  // refetch rebuilds `timeline` object identities).
  const selectedHeadIsCurrent =
    timeline !== undefined && timeline.selected.headSha === meta.headSha;
  const selectedBaseIsCurrent =
    timeline !== undefined &&
    (meta.baseSha === null || timeline.selected.baseSha === meta.baseSha);
  const baseDrift = selectedHeadIsCurrent && !selectedBaseIsCurrent;
  // Unified across the timeline and legacy explicit-span paths: any rendered
  // span whose head is not the PR's current head submits behind the ack.
  const renderedHead = state.kind === "render" ? state.span.head : undefined;
  const staleHead =
    renderedHead !== undefined &&
    meta.headSha !== null &&
    meta.headSha !== renderedHead;
  // Memoized so its reference is stable across PR-meta poll ticks — an inline
  // literal would recreate the composer wiring downstream and bust every
  // ChunkCard's memo boundary on each tick.
  const readOnly = useMemo(
    () => (baseDrift ? { reason: BASE_DRIFT_REASON } : undefined),
    [baseDrift],
  );

  const selectRevision = useCallback(
    (point: DbTimelinePoint) => {
      void navigate({
        // The FULL span is written — head alone cannot address a duplicate-
        // head revision. A jump target (`thread`) is spent once a revision is
        // selected — drop the key entirely (exactOptionalPropertyTypes
        // forbids `undefined`).
        search: ({ thread: _spent, ...rest }) => ({
          ...rest,
          head: point.headSha,
          base: point.baseSha,
        }),
        replace: false,
      });
    },
    [navigate],
  );

  // Outdated-thread → revision jump (BRIEF-24 owns the head-navigation half):
  // a thread anchored on a briefed head navigates to `?head=<anchor>&thread=<id>`
  // (its own base). A miss keeps the affordance disabled — no guessing.
  // `revisionJump` flows into conversationPlan → conversationComposer →
  // every memoized ChunkCard, so its identity must survive PR-meta poll
  // ticks (which rebuild `timeline` and its point objects). Key the memo on
  // a PRIMITIVE fingerprint of the span list — `(head base)` pairs,
  // whitespace-joined; SHAs are hex, the separators cannot collide (the
  // backend's spanKey uses the same property) — and rebuild the pairs from
  // that key.
  const revisionSpansKey = useMemo(
    () =>
      timeline === undefined
        ? undefined
        : timeline.points.map((p) => `${p.headSha} ${p.baseSha}`).join("\n"),
    [timeline],
  );
  const revisionJump = useMemo(() => {
    if (revisionSpansKey === undefined) return undefined;
    const spans = revisionSpansKey.split("\n").map((line) => {
      const [headSha = "", baseSha = ""] = line.split(" ");
      return { headSha, baseSha };
    });
    return {
      knownHeads: new Set(spans.map((span) => span.headSha)),
      onJump: (anchorSha: string, threadId: number) => {
        // Duplicate heads: the HIGHEST-index row wins — the backend's
        // current-entry (`at(-1)`) choice for the same ambiguity.
        const span = spans.findLast((s) => s.headSha === anchorSha);
        void navigate({
          search: (current) => ({
            ...current,
            head: anchorSha,
            ...(span !== undefined ? { base: span.baseSha } : {}),
            thread: threadId,
          }),
          replace: false,
        });
      },
    };
  }, [navigate, revisionSpansKey]);

  // Pin the selected span into the URL: fresh links get the resolved head+base,
  // and base drift is corrected to the revision's OWN base. A DEGRADED (unknown)
  // head is left in place — the page shows latest with a stable note rather
  // than silently rewriting the address the reviewer followed.
  const pinnedSpan = state.kind === "render" ? state.span : undefined;
  useEffect(() => {
    if (pinnedSpan === undefined || timeline?.degraded) return;
    if (search.head === pinnedSpan.head && search.base === pinnedSpan.base) {
      return;
    }
    void navigate({
      search: (current) => ({
        ...current,
        base: pinnedSpan.base,
        head: pinnedSpan.head,
      }),
      replace: true,
    });
  }, [navigate, pinnedSpan, search.base, search.head, timeline?.degraded]);

  // Re-anchor keyboard focus onto the Brief heading region on a state swap or
  // a revision selection (ADR 0019 #7). Keyed by the full SPAN identity —
  // duplicate-head revisions differ only by base, and moving between them
  // swaps the content and read-only posture just like any other selection.
  const selectedSpanKey =
    timeline === undefined
      ? undefined
      : `${timeline.selected.baseSha} ${timeline.selected.headSha}`;
  useEffect(() => {
    document.getElementById("main-content")?.focus();
  }, [state.kind, selectedSpanKey]);

  return (
    <>
      {/* The navigator OWNS head navigation on a multi-revision PR; the legacy
          head-advanced banner only fires on the non-timeline path. */}
      {timeline === undefined &&
      explicit !== undefined &&
      headAdvanced(meta, explicit) ? (
        <HeadAdvancedBanner
          onNavigate={() => {
            void navigate({ search: {}, replace: false });
          }}
        />
      ) : null}
      <PrBriefBody
        meta={meta}
        onNavigateSearch={(next) => {
          void navigate({
            search: (current) => ({ ...current, ...next }),
            replace: false,
          });
        }}
        conversationFocusThreadId={search.thread}
        onSelectRevision={selectRevision}
        prNumber={prNumber}
        readOnly={readOnly}
        repoId={repoId}
        revisionJump={revisionJump}
        searchParams={{
          ...(search.view !== undefined ? { view: search.view } : {}),
          ...(search.compare !== undefined ? { compare: search.compare } : {}),
        }}
        staleHead={staleHead}
        state={state}
        timeline={timeline}
      />
    </>
  );
}
