// Hono-free. The gate proved viewer access; the reads serialize the
// conversation with OUR Entry comment stripped. Two credential worlds: the
// installation token for App rows, the viewer's own token (one per-request
// refresh budget) for owner-world rows. The handler owns posture and the
// per-PR cache.
import {
  createUserOctokit,
  fetchPullRequestConversation,
  type PrConversation,
} from "github";
import { isGitHubDenial } from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import { stripEntryComment } from "./logic/entry-comment";
import type {
  ConversationControllerDeps,
  ReadConversationInput,
  ReadConversationResult,
} from "./types";

/** The wire body both worlds answer with: our Entry comment taken out. */
function serializeStrippedConversation(
  conversation: PrConversation,
  entryCommentId: bigint | null,
): string {
  return JSON.stringify(stripEntryComment(conversation, entryCommentId));
}

export default {
  async readConversation(
    deps: ConversationControllerDeps,
    input: ReadConversationInput,
  ): Promise<ReadConversationResult> {
    const fetched = await deps.github.fetchPullRequestConversation(
      input.installationId,
      { owner: input.owner, repo: input.repo, prNumber: input.prNumber },
    );

    if (!fetched.ok) {
      return {
        ok: false,
        error: { kind: "github-denied", error: fetched.error },
      };
    }

    return {
      ok: true,
      value: serializeStrippedConversation(fetched.value, input.entryCommentId),
    };
  },

  async readConversationAsViewer(
    deps: { readonly github: ReviewerGitHubClient },
    input: Omit<ReadConversationInput, "installationId">,
  ): Promise<ReadConversationResult> {
    const fetched = await deps.github.runRead(
      (token) =>
        fetchPullRequestConversation(createUserOctokit(token), {
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
        }),
      isGitHubDenial,
    );

    if (!fetched.ok) {
      if ("kind" in fetched.error) {
        return { ok: false, error: { kind: "token-unreadable" } };
      }

      return {
        ok: false,
        error: { kind: "github-denied", error: fetched.error },
      };
    }

    return {
      ok: true,
      value: serializeStrippedConversation(fetched.value, input.entryCommentId),
    };
  },
};
