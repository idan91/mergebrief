// The collaborators mention pool as a hook: both composer-wiring sites run
// the same query (react-query dedupes on the key) and read it as a plain
// candidate array. Anything non-ready — disabled/local path, viewerCanPush
// 404, upstream blip, still loading — is an empty pool, and the autocomplete
// falls back to thread participants.
import { useQuery, type QueryKey } from "@tanstack/react-query";

import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import type {
  collaboratorsQueryOptions,
  CollaboratorsResult,
} from "../queries";

const EMPTY_POOL: readonly MentionCandidate[] = [];

// Namespaced so it can never collide with collaboratorsQueryKey(repoId).
const DISABLED_KEY: QueryKey = ["collaborators-disabled"];

export function useMentionPool(
  options: ReturnType<typeof collaboratorsQueryOptions> | undefined,
): readonly MentionCandidate[] {
  const query = useQuery({
    ...(options ?? {
      queryKey: DISABLED_KEY,
      queryFn: async (): Promise<CollaboratorsResult> => ({
        kind: "unavailable",
      }),
    }),
    enabled: options !== undefined,
  });
  return query.data?.kind === "ready" ? query.data.candidates : EMPTY_POOL;
}
