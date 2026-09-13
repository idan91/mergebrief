// The conversation glue facade: the section's open/landing state, the shared
// conversation query and its per-chunk digest, the composer wiring, and the
// digest→diff jump choreography.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ConversationPlan,
  ThreadComposerWiring,
} from "@web/features/conversation";
import {
  applyConversationFilter,
  buildInlineThreads,
  buildThreadsOutsideChunks,
  type DigestThreadRow,
  type ConversationFilter,
  countHiddenInlineThreads,
  DEFAULT_CONVERSATION_FILTER,
  type DigestRow,
  reconcileOwnComments,
  reconcileReviewers,
  type ReviewerFacet,
  reviewerFacets,
  type VerdictFacet,
  verdictFacets,
} from "@web/features/conversation/utils";
import type { ConversationResult } from "@web/features/conversation/queries";
import { useMentionPool } from "@web/features/conversation/hooks";
import { prefersReducedMotion } from "@web/utils/motion";
import type { BriefViewModel } from "../../utils/viewModel";
import type { Mutable } from "types";
import type { BriefChunk } from "../../types";
import {
  conversationGroupIds,
  disabledComparisonQuery,
  SCROLL_ABORT_EVENTS,
} from "./utils";

/** Frames to await a landing target across a windowed jump's whole flight
 * (mount happens as the smooth scroll approaches; ~1.5s at 60Hz). */
const LANDING_POLL_FRAMES = 90;

export interface UseConversationWiringInput {
  briefId: string;
  /** The route's conversation plan; absent on the local path, every output
   * then self-disables. */
  conversation: ConversationPlan | undefined;
  /** The `?thread=` landing target: opens the section on mount AND on in-app
   * navigation that changes the target after mount. */
  conversationFocusThreadId: number | undefined;
  /** Reviewer/verdict filter, separate from the plan so a chip click cannot
   * churn the plan identity the ChunkCard memos ride on. */
  conversationFilter: ConversationFilter | undefined;
  jumpToChunk: (chunkId: string, behavior?: ScrollBehavior) => void;
  /** Conversation landings are row targets, rows only exist on open cards. */
  ensureChunkOpen: (chunkId: string) => void;
  model: BriefViewModel;
  readingOrderedChunks: BriefChunk[];
  submittedReviewIds: number[];
}

/** What the toolbar's Filter disclosure needs to draw itself. */
export interface ConversationFilterFacets {
  readonly verdicts: readonly VerdictFacet[];
  readonly reviewers: readonly ReviewerFacet[];
  readonly hiddenInlineThreads: number;
  /**
   * Applied filter with unmatched reviewers removed. Receipts, pressed states and
   * chip updates share it so ghost logins cannot claim a filter or persist in the URL.
   */
  readonly applied: ConversationFilter;
}

export interface UseConversationWiringValue {
  conversationByChunk: ReadonlyMap<string, DigestRow[]> | undefined;
  /** Live threads on lines no chunk renders, per file. */
  hiddenThreadsByFile: ReadonlyMap<string, DigestThreadRow[]> | undefined;
  /** Facets for the Filter disclosure; absent until the conversation resolves. */
  conversationFilterFacets: ConversationFilterFacets | undefined;
  conversationComposer: ThreadComposerWiring | undefined;
  /** Which groups carry conversation threads, the TocBar's markers. */
  conversationGroupIds: Set<string> | undefined;
  /** Refetches the conversation after a posted inline comment; absent on the
   * local path. */
  invalidateConversation: (() => void) | undefined;
  jumpToChunkFromConversation: (
    chunkId: string,
    target?: { rowId: string; threadId: number },
  ) => void;
  jumpToConversation: () => void;
  open: boolean;
  toggleOpen: () => void;
}

export function useConversationWiring(
  input: UseConversationWiringInput,
): UseConversationWiringValue {
  const {
    briefId,
    conversation,
    conversationFocusThreadId,
    conversationFilter,
    jumpToChunk,
    ensureChunkOpen,
    model,
    readingOrderedChunks,
    submittedReviewIds,
  } = input;

  // Collapse initially to keep the brief visible; open on each new thread target,
  // including navigation after mount. The user may collapse the same target again.
  const [open, setOpen] = useState(conversationFocusThreadId !== undefined);
  useEffect(() => {
    if (conversationFocusThreadId !== undefined) setOpen(true);
  }, [conversationFocusThreadId]);
  const toggleOpen = useCallback(() => setOpen((current) => !current), []);
  const jumpToConversation = useCallback(() => {
    setOpen(true);
    // The heading exists regardless of expansion; focus + scroll land on it
    // after the expand renders.
    window.requestAnimationFrame(() => {
      const heading = document.getElementById("conversation-heading");
      if (!(heading instanceof HTMLElement)) return;
      heading.scrollIntoView({ block: "start" });
      heading.focus({ preventScroll: true });
    });
  }, []);

  // Inline conversation threads: the same query the section runs (react-query
  // dedupes on the key), disabled on the local path.
  const queryClient = useQueryClient();
  const conversationOptions =
    conversation?.queryOptions ??
    disabledComparisonQuery<ConversationResult>("conversation");
  const conversationQuery = useQuery({
    ...conversationOptions,
    enabled: conversation !== undefined,
  });
  const conversationData =
    conversationQuery.data?.kind === "ready"
      ? conversationQuery.data.conversation
      : undefined;
  // The filter reaches the diff too: a reviewer chip that left their inline
  // threads in place would answer "who said what" only halfway.
  const conversationByChunk = useMemo(() => {
    if (conversationData === undefined) return undefined;
    const filtered = applyConversationFilter(
      conversationData,
      reconcileReviewers(
        conversationFilter ?? DEFAULT_CONVERSATION_FILTER,
        conversationData,
      ),
    );
    // Ownership is the review-id join alone, local comments feed only the
    // pointer/resurrection outputs, so they stay OUT of these deps: a comment
    // save/toggle must not rebuild every chunk's inline rows and bust the
    // ChunkCard memo boundary.
    const ownThreadIds = reconcileOwnComments(
      [],
      filtered.threads,
      submittedReviewIds,
    ).ownThreadIds;
    return buildInlineThreads({
      conversation: filtered,
      chunks: readingOrderedChunks,
      ownThreadIds,
      // The cutoff is a primitive dep (not the plan object): the plan is
      // route-memoized, but only this field affects the rows.
      briefGeneratedAt: conversation?.briefGeneratedAt,
    });
  }, [
    conversationData,
    conversationFilter,
    readingOrderedChunks,
    submittedReviewIds,
    conversation?.briefGeneratedAt,
  ]);

  // Unfiltered on purpose: a hidden thread is hidden whoever wrote it, and
  // an expansion surfaces it the same way.
  const hiddenThreadsByFile = useMemo(() => {
    if (conversationData === undefined) return undefined;
    const ownThreadIds = reconcileOwnComments(
      [],
      conversationData.threads,
      submittedReviewIds,
    ).ownThreadIds;
    return buildThreadsOutsideChunks({
      conversation: conversationData,
      chunks: readingOrderedChunks,
      ownThreadIds,
      briefGeneratedAt: conversation?.briefGeneratedAt,
    });
  }, [
    conversationData,
    readingOrderedChunks,
    submittedReviewIds,
    conversation?.briefGeneratedAt,
  ]);

  // The Filter disclosure renders in the toolbar ABOVE the section and
  // outside its collapsed body, so the facets are computed here. Reconciled
  // first, so the counts describe the same conversation the section and the
  // diff render.
  const conversationFilterFacets = useMemo(() => {
    if (conversationData === undefined) return undefined;
    const applied = reconcileReviewers(
      conversationFilter ?? DEFAULT_CONVERSATION_FILTER,
      conversationData,
    );
    return {
      verdicts: verdictFacets(conversationData, applied),
      reviewers: reviewerFacets(conversationData),
      hiddenInlineThreads: countHiddenInlineThreads(
        conversationData,
        applied,
        readingOrderedChunks,
      ),
      applied,
    };
  }, [conversationData, conversationFilter, readingOrderedChunks]);

  // Slim transport (draft reads/writes and announce copy live inside
  // ReplyComposer's session-store reads): identity stable per plan, so it
  // never busts ChunkCard's memo. The mention pool shares the section's query
  // key, one fetch serves both surfaces.
  const mentionPool = useMentionPool(conversation?.collaborators);

  const conversationComposer = useMemo<ThreadComposerWiring | undefined>(() => {
    if (conversation === undefined) return undefined;

    const composer: Mutable<ThreadComposerWiring> = {
      post: conversation.postReply,
      mentionPool,
      onPosted: () =>
        void queryClient.invalidateQueries({
          queryKey: conversation.queryOptions.queryKey,
        }),
    };

    // Resolution rides the inline (at-chunk) threads too: same
    // thread, same capability, same shared query key.
    if (conversation.resolution !== undefined) {
      composer.resolution = {
        ...conversation.resolution,
        refetchConversation: () =>
          void queryClient.invalidateQueries({
            queryKey: conversation.queryOptions.queryKey,
          }),
      };
    }

    return composer;
  }, [conversation, mentionPool, queryClient]);

  const groupIds = useMemo(
    () => conversationGroupIds(conversationByChunk, model.groups),
    [conversationByChunk, model.groups],
  );

  // A posted inline comment is a conversation write, refetch so the new
  // thread renders. The query client is app-level, not mount-level, so
  // invalidating from the post path's closure is remount-safe.
  const invalidateConversation = useMemo(
    () =>
      conversation === undefined
        ? undefined
        : () =>
            void queryClient.invalidateQueries({
              queryKey: conversation.queryOptions.queryKey,
            }),
    [conversation, queryClient],
  );

  // Focus the thread's own diff row, falling back to the chunk for aggregated bots.
  // A resolved bot has no row. Restart the flash on repeated jumps by forcing reflow;
  // replace the old timer so it cannot cut the new flash short.
  const flashTimerRef = useRef<{ el: HTMLElement; timer: number } | null>(null);
  const flashConversationTarget = useCallback((target: HTMLElement) => {
    const pending = flashTimerRef.current;
    if (pending !== null) {
      window.clearTimeout(pending.timer);
      pending.el.removeAttribute("data-conversation-flash");
      flashTimerRef.current = null;
    }
    target.removeAttribute("data-conversation-flash");
    window.requestAnimationFrame(() => {
      target.setAttribute("data-conversation-flash", "");
      flashTimerRef.current = {
        el: target,
        timer: window.setTimeout(() => {
          target.removeAttribute("data-conversation-flash");
          flashTimerRef.current = null;
        }, 1600),
      };
    });
  }, []);
  // One landing chain at a time: a fresh jump (or a brief switch, this
  // hook's host no longer remounts per brief) cancels the previous poll, or
  // a stale loop could steal focus onto a same-id element of the NEXT brief.
  const landingFrameRef = useRef<number | null>(null);
  const removeAbortRef = useRef<(() => void) | null>(null);
  const cancelLanding = useCallback(() => {
    if (landingFrameRef.current !== null) {
      window.cancelAnimationFrame(landingFrameRef.current);
      landingFrameRef.current = null;
    }
    // A stale landing's abort listeners must not survive into the next
    // jump, one firing would cancel the NEW landing.
    removeAbortRef.current?.();
    removeAbortRef.current = null;
  }, []);
  useEffect(() => cancelLanding, [briefId, cancelLanding]);

  const jumpToChunkFromConversation = useCallback(
    (chunkId: string, target?: { rowId: string; threadId: number }) => {
      cancelLanding();
      // Row target: the thread row only renders on an open card.
      ensureChunkOpen(chunkId);
      // The user's own input aborts the landing, a late focus() would yank
      // them away from wherever they moved.
      for (const type of SCROLL_ABORT_EVENTS) {
        window.addEventListener(type, cancelLanding, {
          once: true,
          passive: true,
        });
      }
      removeAbortRef.current = () => {
        for (const type of SCROLL_ABORT_EVENTS) {
          window.removeEventListener(type, cancelLanding);
        }
      };
      // A windowed list mounts the card only as the scroll approaches it, so
      // both landings poll across the scroll's whole flight, not one frame.
      const landOnChunk = (attemptsLeft: number) => {
        landingFrameRef.current = null;
        const el = document.getElementById(chunkId);
        if (!(el instanceof HTMLElement)) {
          if (attemptsLeft > 0)
            landingFrameRef.current = window.requestAnimationFrame(() => {
              landOnChunk(attemptsLeft - 1);
            });
          return;
        }
        el.focus({ preventScroll: true });
        flashConversationTarget(el);
      };
      if (target === undefined) {
        jumpToChunk(chunkId);
        landingFrameRef.current = window.requestAnimationFrame(() => {
          landOnChunk(LANDING_POLL_FRAMES);
        });
        return;
      }
      // Instant coarse jump (expands the chunk), then settle on the row. The
      // row renders only once the chunk is open and mounted, so poll before
      // conceding to the chunk top.
      jumpToChunk(chunkId, "auto");
      let attempts = LANDING_POLL_FRAMES;
      const landOnRow = () => {
        landingFrameRef.current = null;
        const row = document.querySelector(
          `[data-conversation-thread="${target.threadId}"]`,
        );
        if (row instanceof HTMLElement) {
          // Same reduced-motion gate as every other programmatic scroll.
          row.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "center",
          });
          const disclosure = row.querySelector("button");
          (disclosure ?? row).focus({ preventScroll: true });
          flashConversationTarget(row);
          return;
        }
        attempts -= 1;
        if (attempts > 0)
          landingFrameRef.current = window.requestAnimationFrame(landOnRow);
        else landOnChunk(0);
      };
      landingFrameRef.current = window.requestAnimationFrame(landOnRow);
    },
    [cancelLanding, ensureChunkOpen, flashConversationTarget, jumpToChunk],
  );

  return {
    conversationByChunk,
    hiddenThreadsByFile,
    conversationFilterFacets,
    conversationComposer,
    conversationGroupIds: groupIds,
    invalidateConversation,
    jumpToChunkFromConversation,
    jumpToConversation,
    open,
    toggleOpen,
  };
}
