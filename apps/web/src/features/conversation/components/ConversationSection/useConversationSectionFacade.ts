import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { buildMentionSource } from "../../utils/mentions";
import type { ConversationSectionProps } from ".";
import { useDigestDisclosure } from "./hooks/useDigestDisclosure";
import { useFilteredConversation } from "./hooks/useFilteredConversation";
import { useOwnComments } from "./hooks/useOwnComments";
import { useThreadLanding } from "./hooks/useThreadLanding";
import { buildThreadComposer, listHeadSummaryParts } from "./utils";

/**
 * The conversation section's reads and state: the fetched conversation as the
 * filter leaves it, the digest built from it, what is open, and the wiring a
 * thread's composer writes through.
 */
export function useConversationSectionFacade(props: ConversationSectionProps) {
  const { plan, chunks, focusThreadId, open } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery(plan.queryOptions);
  const disclosure = useDigestDisclosure();

  const conversation =
    query.data?.kind === "ready" ? query.data.conversation : undefined;
  const mentionSource = useMemo(
    () => buildMentionSource(plan.mentionRepoId, conversation),
    [conversation, plan.mentionRepoId],
  );
  const reconciliation = useOwnComments({
    conversation,
    localComments: props.localComments,
    submittedReviewIds: props.submittedReviewIds,
    markCommentsSubmitted: props.markCommentsSubmitted,
  });

  const { filter, filtered, digest, afterBriefCount } = useFilteredConversation(
    {
      conversation,
      requestedFilter: props.filter,
      focusThreadId,
      chunks,
      briefGeneratedAt: plan.briefGeneratedAt,
      reconciliation,
      t,
    },
  );

  const relandInPlace = useThreadLanding({
    focusThreadId,
    open,
    conversation,
    digest,
    revealThread: disclosure.revealThread,
    beginSmoothScroll: props.beginSmoothScroll,
  });

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: plan.queryOptions.queryKey,
    });

  const composer = buildThreadComposer({
    plan,
    readOnlyReason: props.readOnlyReason,
    mentionSource,
    focusThreadId,
    refresh,
    relandInPlace,
  });

  // Empty-bodied COMMENTED reviews (GitHub's envelope around inline
  // comments) are already dropped by `applyConversationFilter`.
  const verdicts = filtered?.reviews ?? [];
  const summaryParts =
    conversation === undefined
      ? []
      : listHeadSummaryParts(conversation, afterBriefCount);

  return {
    query,
    conversation,
    filter,
    digest,
    verdicts,
    summaryParts,
    composer,
    disclosure,
    refresh,
  };
}
