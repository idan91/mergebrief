// Hono-free. The gate proved viewer access; this op is the installation-token
// conversation read, serialized with OUR Entry comment stripped. The handler
// owns posture and the per-PR cache.
import type { Result } from "types";
import { stripEntryComment } from "./logic/entry-comment";
import type {
  ConversationControllerDeps,
  ConversationFailure,
  ReadConversationInput,
} from "./types";

type ReadConversationResult = Result<string, ConversationFailure>;

export default {
  async readConversation(
    deps: ConversationControllerDeps,
    input: ReadConversationInput,
  ) {
    const fetched = await deps.github.fetchPullRequestConversation(
      input.installationId,
      { owner: input.owner, repo: input.repo, prNumber: input.prNumber },
    );
    if (!fetched.ok) {
      return {
        ok: false,
        error: { kind: "github-denied", error: fetched.error },
      } satisfies ReadConversationResult;
    }
    return {
      ok: true,
      value: JSON.stringify(
        stripEntryComment(fetched.value, input.entryCommentId),
      ),
    } satisfies ReadConversationResult;
  },
};
