import { useCallback, useMemo } from "react";

import type { NavigateSearch } from "@web/features/brief";
import {
  conversationFilterSearch,
  parseConversationFilter,
  type ConversationFilter,
} from "@web/features/conversation/utils";
import { buildPrSearch } from "../../search";
import type { PrBriefSearch } from "../../search/types";
import type { ConversationFilterParams } from "./types";

/**
 * The conversation filter as URL state. Identity holds on the raw param
 * strings: the parsed filter carries fresh Sets, and it rides into the memo
 * boundaries that keep inline threads off the render path. A filter write
 * replaces, so ten chip clicks are not ten back-button steps.
 */
export function useConversationFilterParams(
  search: PrBriefSearch,
  navigate: NavigateSearch<PrBriefSearch>,
): ConversationFilterParams {
  const { verdicts, reviewers, reviews } = search;
  const conversationFilter = useMemo(
    () => parseConversationFilter({ verdicts, reviewers, reviews }),
    [reviewers, reviews, verdicts],
  );

  const onConversationFilterChange = useCallback(
    (next: ConversationFilter) => {
      const projected = conversationFilterSearch(next);
      void navigate({
        search: (previous) =>
          buildPrSearch(previous, {
            verdicts: projected.verdicts,
            reviewers: projected.reviewers,
            reviews: projected.reviews,
          }),
        replace: true,
      });
    },
    [navigate],
  );

  return { conversationFilter, onConversationFilterChange };
}
