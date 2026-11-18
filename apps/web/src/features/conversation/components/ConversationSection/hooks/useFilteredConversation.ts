import type { TFunction } from "i18next";
import { useMemo } from "react";

import type { BriefChunk } from "@web/features/brief/model";
import type { PrConversation } from "../../../types";
import {
  buildConversationDigest,
  type DigestGroup,
} from "../../../utils/digest";
import {
  DEFAULT_CONVERSATION_FILTER,
  reconcileReviewers,
  type ConversationFilter,
} from "../../../utils/filter";
import type { OwnCommentReconciliation } from "../../../utils/ownComments";
import {
  NO_OWN_REVIEWS,
  countCommentsAfterBrief,
} from "../../../utils/postdate";
import { filterForLanding } from "../utils";

export interface FilteredConversationInput {
  conversation: PrConversation | undefined;
  requestedFilter: ConversationFilter | undefined;
  focusThreadId: number | undefined;
  chunks: readonly BriefChunk[];
  briefGeneratedAt: string | undefined;
  reconciliation: OwnCommentReconciliation | undefined;
  t: TFunction;
}

/** The fetched conversation as the filter leaves it, and what the section reads off it. */
export interface FilteredConversation {
  filter: ConversationFilter;
  filtered: PrConversation | undefined;
  digest: DigestGroup[];
  afterBriefCount: number;
}

export function useFilteredConversation(
  input: FilteredConversationInput,
): FilteredConversation {
  const { conversation, focusThreadId, chunks, briefGeneratedAt } = input;
  const { reconciliation, t } = input;

  // The filter as it applies to THIS conversation: logins nobody matches are
  // dropped, so a stale shared link loosens instead of emptying the section.
  const requestedFilter = input.requestedFilter ?? DEFAULT_CONVERSATION_FILTER;
  const filter = useMemo(
    () =>
      conversation === undefined
        ? requestedFilter
        : reconcileReviewers(requestedFilter, conversation),
    [conversation, requestedFilter],
  );

  // Everything below reads the FILTERED conversation through this one call,
  // so the strip, the digest and the diff can never disagree.
  const filtered = useMemo(
    () =>
      conversation === undefined
        ? undefined
        : filterForLanding(conversation, filter, focusThreadId),
    [conversation, filter, focusThreadId],
  );

  const digest = useMemo(
    () =>
      filtered === undefined
        ? []
        : buildConversationDigest(t, {
            conversation: filtered,
            chunks,
            ownThreadIds: reconciliation?.ownThreadIds ?? new Set(),
            briefGeneratedAt,
            ownReviewIds: reconciliation?.ownReviewIds,
          }),
    [chunks, filtered, briefGeneratedAt, reconciliation, t],
  );

  // Comments the viewed revision's brief cannot account for, an older
  // revision honestly counts more; zero (or no cutoff) renders nothing.
  const afterBriefCount = useMemo(
    () =>
      conversation === undefined
        ? 0
        : countCommentsAfterBrief(
            conversation,
            briefGeneratedAt,
            reconciliation?.ownReviewIds ?? NO_OWN_REVIEWS,
          ),
    [conversation, briefGeneratedAt, reconciliation],
  );

  return { filter, filtered, digest, afterBriefCount };
}
