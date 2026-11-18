import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type {
  ConversationPlan,
  ThreadComposerWiring,
} from "@web/features/conversation";
import type { ConversationResult } from "@web/features/conversation/queries";
import type { PrConversation } from "@web/features/conversation/types";
import { buildMentionSource } from "@web/features/conversation/utils";
import type { Mutable } from "types/utils";
import {
  buildReplyRecordingPlan,
  countGroupThreads,
  disabledComparisonQuery,
} from "../utils";
import type { ConversationState, UseConversationInput } from "./types";
import { useConversationRows } from "./useConversationRows";
import { useConversationScroll } from "./useConversationScroll";
import { focusConversationHeading } from "./utils";

export function useConversation({
  conversation,
  model,
  session,
}: UseConversationInput): ConversationState {
  const source = conversation?.plan;
  const { recordSubmittedReview } = session.actions;

  // Keyed on the plan alone, never the capability: a filter chip click must
  // not churn the plan identity both composer wirings memo on.
  const conversationPlan = useMemo(
    () =>
      source === undefined
        ? undefined
        : buildReplyRecordingPlan(source, recordSubmittedReview),
    [source, recordSubmittedReview],
  );

  const section = useConversationSection(conversation?.focusThreadId);
  const { queryClient, conversationData } =
    useConversationQuery(conversationPlan);
  const rows = useConversationRows({
    conversationData,
    conversationFilter: conversation?.filter,
    readingOrderedChunks: session.readingOrderedChunks,
    submittedReviewIds: session.submittedReviewIds,
    briefGeneratedAt: conversationPlan?.briefGeneratedAt,
  });
  const composer = useConversationComposer(
    conversationPlan,
    conversationData,
    queryClient,
  );
  const threadCounts = countGroupThreads(
    rows.conversationByChunk,
    model.groups,
  );
  const jumpToChunkFromConversation = useConversationScroll({
    scrollToTarget: session.scrollToTarget,
    setActiveChunk: session.setActiveChunk,
  });

  return {
    conversationPlan,
    conversationWiring: {
      conversationByChunk: rows.conversationByChunk,
      hiddenThreadsByFile: rows.hiddenThreadsByFile,
      lineThreadsByFile: rows.lineThreadsByFile,
      conversationFilterFacets: rows.conversationFilterFacets,
      conversationComposer: composer.conversationComposer,
      groupThreadCounts: threadCounts,
      invalidateConversation: composer.invalidateConversation,
      jumpToChunkFromConversation,
      jumpToConversation: section.jumpToConversation,
      open: section.open,
      toggleOpen: section.toggleOpen,
    },
  };
}

/**
 * Collapsed at first to keep the brief visible; opens on each new `?thread=`
 * target, including navigation after mount. The user may collapse the same
 * target again.
 */
function useConversationSection(focusThreadId: number | undefined) {
  const [open, setOpen] = useState(focusThreadId !== undefined);
  useEffect(() => {
    if (focusThreadId !== undefined) {
      setOpen(true);
    }
  }, [focusThreadId]);
  const toggleOpen = () => setOpen((current) => !current);
  const jumpToConversation = () => {
    setOpen(true);
    focusConversationHeading();
  };

  return { open, toggleOpen, jumpToConversation };
}

/**
 * The same query the section runs (react-query dedupes on the key), disabled
 * on the local path.
 */
function useConversationQuery(conversation: ConversationPlan | undefined) {
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

  return { queryClient, conversationData };
}

function useConversationComposer(
  conversation: ConversationPlan | undefined,
  conversationData: PrConversation | undefined,
  queryClient: QueryClient,
) {
  // Slim transport (draft reads/writes and announce copy live inside
  // ReplyComposer's session-store reads). Its identity, and so ChunkCard's
  // memo, changes only with the plan or a refetched conversation.
  const mentionRepoId = conversation?.mentionRepoId;
  const mentionSource = useMemo(
    () => buildMentionSource(mentionRepoId, conversationData),
    [conversationData, mentionRepoId],
  );

  const conversationComposer = useMemo<ThreadComposerWiring | undefined>(() => {
    if (conversation === undefined) {
      return undefined;
    }

    const composer: Mutable<ThreadComposerWiring> = {
      post: conversation.postReply,
      mentionSource,
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
  }, [conversation, mentionSource, queryClient]);

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

  return { conversationComposer, invalidateConversation };
}
