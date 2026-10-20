import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type {
  MentionCandidate,
  MentionSuggestions,
} from "@web/components/MarkdownTextarea/types";
import { useDebouncedValue } from "./useDebouncedValue";
import { buildMentionSuggestionsQueryOptions } from "../queries";
import type { MentionSource } from "../types";
import { isMentionSearchable, mergeMentionCandidates } from "../utils/mentions";

const MENTION_SEARCH_DEBOUNCE_MS = 200;

const NO_CANDIDATES: readonly MentionCandidate[] = [];

/** The `MarkdownTextarea` props that put its mention list in the caller's hands. */
export interface MentionSuggestionProps {
  readonly mentionSuggestions: MentionSuggestions | undefined;
  readonly onMentionQueryChange:
    | ((query: string | undefined) => void)
    | undefined;
}

const NO_MENTIONS: MentionSuggestionProps = {
  mentionSuggestions: undefined,
  onMentionQueryChange: undefined,
};

/**
 * Mention suggestions for one composer: matching participants first, then
 * what GitHub offers for the text typed after `@`, searched once it holds
 * still. Without a source, mentions are off.
 */
export function useMentionSuggestions(
  source: MentionSource | undefined,
): MentionSuggestionProps {
  const [activeQuery, setActiveQuery] = useState<string | undefined>();
  const debouncedQuery = useDebouncedValue(
    activeQuery,
    MENTION_SEARCH_DEBOUNCE_MS,
  );
  const repoId = source?.repoId;
  const participants = source?.participants;

  const search = useQuery({
    ...buildMentionSuggestionsQueryOptions(repoId ?? "", debouncedQuery ?? ""),
    enabled: isMentionSearchable(repoId, debouncedQuery),
    placeholderData: keepPreviousData,
  });
  const loweredQuery = activeQuery?.toLowerCase();
  const failedForQuery =
    search.isError && debouncedQuery?.toLowerCase() === loweredQuery;
  const answered = search.data?.query === loweredQuery || failedForQuery;
  const pending = isMentionSearchable(repoId, activeQuery) && !answered;

  const candidates = useMemo(() => {
    if (participants === undefined) {
      return NO_CANDIDATES;
    }
    return mergeMentionCandidates(activeQuery ?? "", participants, search.data);
  }, [activeQuery, participants, search.data]);
  const mentionSuggestions = useMemo<MentionSuggestions>(
    () => ({ query: activeQuery ?? "", candidates, pending }),
    [activeQuery, candidates, pending],
  );

  return useMemo(() => {
    if (source === undefined) {
      return NO_MENTIONS;
    }
    return { mentionSuggestions, onMentionQueryChange: setActiveQuery };
  }, [mentionSuggestions, source]);
}
