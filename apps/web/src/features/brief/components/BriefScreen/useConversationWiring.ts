// The conversation glue facade: the section's open/landing state, the shared
// conversation query and its per-chunk digest, the composer wiring, and the
// digest→diff jump choreography (BRIEF-25).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ConversationPlan,
  ThreadComposerWiring,
} from "@web/features/conversation";
import {
  buildInlineThreads,
  type DigestRow,
} from "@web/features/conversation/utils/digest";
import { reconcileOwnComments } from "@web/features/conversation/utils/ownComments";
import type { ConversationResult } from "@web/features/conversation/queries";
import { prefersReducedMotion } from "@web/utils/motion";
import type { BriefViewModel } from "../../utils/viewModel";
import type { BriefChunk } from "../../types";
import { conversationGroupIds, disabledComparisonQuery } from "./utils";

export interface UseConversationWiringInput {
  briefId: string;
  /** The route's conversation plan; absent on the local path — every output
   * then self-disables. */
  conversation: ConversationPlan | undefined;
  /** The `?thread=` landing target (BRIEF-24): opens the section on mount AND
   * on in-app navigation that changes the target after mount. */
  conversationFocusThreadId: number | undefined;
  jumpToChunk: (chunkId: string, behavior?: ScrollBehavior) => void;
  model: BriefViewModel;
  readingOrderedChunks: BriefChunk[];
  submittedReviewIds: number[];
}

export interface UseConversationWiringValue {
  conversationByChunk: ReadonlyMap<string, DigestRow[]> | undefined;
  conversationComposer: ThreadComposerWiring | undefined;
  /** Which groups carry conversation threads — the TocBar's markers. */
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
    jumpToChunk,
    model,
    readingOrderedChunks,
    submittedReviewIds,
  } = input;

  // The conversation section collapses to its summary header by default — it
  // sits ABOVE the change groups, so expanded-by-default would push the Brief
  // down. The C shortcut expands. A `?thread=` landing (BRIEF-24) opens it so
  // its target is reachable — including when the param arrives via in-app
  // navigation AFTER mount (an initializer alone would leave the section
  // collapsed). The user can still collapse it afterwards: the effect
  // re-fires only when the TARGET changes, not on every render (navigation
  // event, not state sync).
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

  // Inline conversation threads (BRIEF-25): the same query the section runs
  // (react-query dedupes on the key), disabled on the local path.
  const queryClient = useQueryClient();
  const conversationQuery = useQuery({
    ...(conversation?.queryOptions ??
      disabledComparisonQuery<ConversationResult>("conversation")),
    enabled: conversation !== undefined,
  });
  const conversationData =
    conversationQuery.data?.kind === "ready"
      ? conversationQuery.data.conversation
      : undefined;
  const conversationByChunk = useMemo(() => {
    if (conversationData === undefined) return undefined;
    // Ownership is the review-id join alone — local comments feed only the
    // pointer/resurrection outputs, so they stay OUT of these deps: a comment
    // save/toggle must not rebuild every chunk's inline rows and bust the
    // ChunkCard memo boundary.
    const ownThreadIds = reconcileOwnComments(
      [],
      conversationData.threads,
      submittedReviewIds,
    ).ownThreadIds;
    return buildInlineThreads({
      conversation: conversationData,
      chunks: readingOrderedChunks,
      ownThreadIds,
      // The cutoff is a primitive dep (not the plan object): the plan is
      // route-memoized, but only this field affects the rows.
      briefGeneratedAt: conversation?.briefGeneratedAt,
    });
  }, [
    conversationData,
    readingOrderedChunks,
    submittedReviewIds,
    conversation?.briefGeneratedAt,
  ]);

  // Slim transport (draft reads/writes and announce copy live inside
  // ReplyComposer's session-store reads): identity stable per plan, so it
  // never busts ChunkCard's memo.
  const conversationComposer = useMemo<ThreadComposerWiring | undefined>(
    () =>
      conversation === undefined
        ? undefined
        : {
            briefId,
            post: conversation.postReply,
            onPosted: () =>
              void queryClient.invalidateQueries({
                queryKey: conversation.queryOptions.queryKey,
              }),
          },
    [briefId, conversation, queryClient],
  );

  const groupIds = useMemo(
    () => conversationGroupIds(conversationByChunk, model.groups),
    [conversationByChunk, model.groups],
  );

  // A posted inline comment is a conversation write — refetch so the new
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

  // The conversation jump contract (BRIEF-25): move focus WITH the scroll and
  // flash the target (reduced-motion respected in CSS). When the digest hands
  // us a row target, land on the thread's OWN row inside the diff — the chunk
  // top is only the fallback (bot threads aggregate at the chunk; a resolved
  // bot thread has no row at all).
  // One live flash timer: a repeat jump inside the window must RESTART the
  // flash (remove → reflow → re-add; a matching attribute never restarts a
  // CSS animation) instead of letting the first jump's timer cut it short.
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
  const jumpToChunkFromConversation = useCallback(
    (chunkId: string, target?: { rowId: string; threadId: number }) => {
      const landOnChunk = () => {
        const el = document.getElementById(chunkId);
        if (!(el instanceof HTMLElement)) return;
        el.focus({ preventScroll: true });
        flashConversationTarget(el);
      };
      if (target === undefined) {
        jumpToChunk(chunkId);
        window.requestAnimationFrame(landOnChunk);
        return;
      }
      // Instant coarse jump (expands the chunk), then settle on the row. The
      // row renders only once the chunk is open, so poll a few frames before
      // conceding to the chunk top.
      jumpToChunk(chunkId, "auto");
      let attempts = 8;
      const landOnRow = () => {
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
        if (attempts > 0) window.requestAnimationFrame(landOnRow);
        else landOnChunk();
      };
      window.requestAnimationFrame(landOnRow);
    },
    [flashConversationTarget, jumpToChunk],
  );

  return {
    conversationByChunk,
    conversationComposer,
    conversationGroupIds: groupIds,
    invalidateConversation,
    jumpToChunkFromConversation,
    jumpToConversation,
    open,
    toggleOpen,
  };
}
