// The conversation glue facade: the section's open state, the shared
// conversation query, the composer wiring, and the two sub-hooks that turn
// the conversation into diff rows and carry out the digest-to-diff jump.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { ThreadComposerWiring } from "@web/features/conversation";
import type { ConversationResult } from "@web/features/conversation/queries";
import { useMentionPool } from "@web/features/conversation/hooks";
import type { Mutable } from "types/utils";
import { conversationGroupIds, disabledComparisonQuery } from "../utils";
import type {
  UseConversationWiringInput,
  UseConversationWiringValue,
} from "./types";
import { useConversationScroll } from "./useConversationScroll";
import { useConversationRows } from "./useConversationRows";
import { focusConversationHeading } from "./utils";

export function useConversationWiring(
  input: UseConversationWiringInput,
): UseConversationWiringValue {
  const {
    conversation,
    conversationFocusThreadId,
    conversationFilter,
    scrollToTarget,
    setActiveChunk,
    model,
    readingOrderedChunks,
    submittedReviewIds,
  } = input;

  // Collapse initially to keep the brief visible; open on each new thread target,
  // including navigation after mount. The user may collapse the same target again.
  const [open, setOpen] = useState(conversationFocusThreadId !== undefined);
  useEffect(() => {
    if (conversationFocusThreadId !== undefined) {
      setOpen(true);
    }
  }, [conversationFocusThreadId]);
  const toggleOpen = () => setOpen((current) => !current);
  const jumpToConversation = () => {
    setOpen(true);
    focusConversationHeading();
  };

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

  const rows = useConversationRows({
    conversationData,
    conversationFilter,
    readingOrderedChunks,
    submittedReviewIds,
    briefGeneratedAt: conversation?.briefGeneratedAt,
  });

  // Slim transport (draft reads/writes and announce copy live inside
  // ReplyComposer's session-store reads): identity stable per plan, so it
  // never busts ChunkCard's memo. The mention pool shares the section's query
  // key, one fetch serves both surfaces.
  const mentionPool = useMentionPool(conversation?.collaborators);

  const conversationComposer = useMemo<ThreadComposerWiring | undefined>(() => {
    if (conversation === undefined) {
      return undefined;
    }

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

  const groupIds = conversationGroupIds(rows.conversationByChunk, model.groups);

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

  const jumpToChunkFromConversation = useConversationScroll({
    scrollToTarget,
    setActiveChunk,
  });

  return {
    conversationByChunk: rows.conversationByChunk,
    hiddenThreadsByFile: rows.hiddenThreadsByFile,
    lineThreadsByFile: rows.lineThreadsByFile,
    conversationFilterFacets: rows.conversationFilterFacets,
    conversationComposer,
    conversationGroupIds: groupIds,
    invalidateConversation,
    jumpToChunkFromConversation,
    jumpToConversation,
    open,
    toggleOpen,
  };
}
