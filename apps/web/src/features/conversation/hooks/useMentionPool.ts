// Both composers share the query key. Non-ready results become an empty pool,
// so autocomplete falls back to thread participants on unavailable or failed reads.
import { useQuery, type QueryKey } from "@tanstack/react-query";

import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import type {
  buildCollaboratorsQueryOptions,
  CollaboratorsResult,
} from "../queries";

const EMPTY_POOL: readonly MentionCandidate[] = [];

// Namespaced so it can never collide with buildCollaboratorsQueryKey(repoId).
const DISABLED_KEY: QueryKey = ["collaborators-disabled"];

export function useMentionPool(
  options: ReturnType<typeof buildCollaboratorsQueryOptions> | undefined,
): readonly MentionCandidate[] {
  const queryOptions = options ?? {
    queryKey: DISABLED_KEY,
    queryFn: async (): Promise<CollaboratorsResult> => ({
      kind: "unavailable",
    }),
  };
  const query = useQuery({ ...queryOptions, enabled: options !== undefined });
  return query.data?.kind === "ready" ? query.data.candidates : EMPTY_POOL;
}
