import type { EntryCommentLink } from "../../entry-comment";
import type { ParsedGeneratePayload } from "../../payload";
import type { EntryCommentManager, EntryCommentManagerInputs } from "../types";

/**
 * The Entry comment id rotates up to twice per run (generating → ready);
 * track the live value, the prRow snapshot goes stale after the first
 * rotation, and deleting by a stale id would orphan the newer comment.
 */
export function createEntryCommentManager(
  payload: ParsedGeneratePayload,
  inputs: EntryCommentManagerInputs,
): EntryCommentManager {
  const { source, repo, prRow, publicBaseUrl, log } = inputs;
  const comments = source.entryComments;
  const { pullRequestId, headSha } = payload;
  let liveEntryCommentId: bigint | null = prRow.entryCommentId;

  function getCurrentId(): bigint | null {
    return liveEntryCommentId;
  }

  function buildDeepLink(headIndex: number): EntryCommentLink {
    return {
      publicBaseUrl,
      repoId: prRow.repoId,
      prNumber: prRow.prNumber,
      headIndex,
      headSha,
    };
  }

  /**
   * Delete-only sweep for the suppressed state: remove the live Entry comment
   * (404-tolerant) and clear the stored id. Failures never fail the job, the
   * next drain retries naturally.
   */
  async function removeEntryComment(): Promise<void> {
    if (comments === undefined || liveEntryCommentId === null) {
      return;
    }
    const deleted = await comments.deleteComment(liveEntryCommentId);
    if (!deleted.ok) {
      log.warn(
        `generate: stale entry comment delete failed (job unaffected) — ${deleted.error.message}`,
      );
      return;
    }
    liveEntryCommentId = null;
    const cleared = await repo.pullRequests.setEntryComment(
      pullRequestId,
      null,
    );
    if (cleared === undefined) {
      log.warn(
        `generate: entry comment id not cleared (job unaffected) — pull_request ${pullRequestId} not found`,
      );
    }
  }

  /**
   * True when the tracked Entry comment exists and its live body already
   * equals `body`. Any uncertainty (no tracked id, comment gone, fetch
   * failure) reports false so the caller falls back to the delete+repost
   * cycle, the self-heals stay intact.
   */
  async function matchesEntryComment(body: string): Promise<boolean> {
    if (comments === undefined || liveEntryCommentId === null) {
      return false;
    }
    const fetched = await comments.fetchComment(liveEntryCommentId);
    if (!fetched.ok) {
      log.warn(
        `generate: entry comment fetch failed (job unaffected) — ${fetched.error.message}`,
      );
      return false;
    }
    const bodyMatches =
      fetched.value !== undefined && fetched.value.body === body;
    return bodyMatches;
  }

  /**
   * Delete/repost rotates the one Entry id and supplies the ready notification ping.
   * The adapter treats already-deleted ids as success. GitHub or storage failures must not
   * fail generation; a later settled head can retry the cycle.
   */
  async function refreshEntryComment(body: string): Promise<void> {
    if (comments === undefined) {
      return;
    }
    if (liveEntryCommentId !== null) {
      const deleted = await comments.deleteComment(liveEntryCommentId);
      if (!deleted.ok) {
        // Skip the repost: posting past a live comment we failed to delete
        // would leave two. The stored id survives for the next run's retry.
        log.warn(
          `generate: entry comment delete failed (job unaffected) — ${deleted.error.message}`,
        );
        return;
      }
      liveEntryCommentId = null;
    }
    const posted = await comments.postEntryComment({
      prNumber: prRow.prNumber,
      body,
    });
    if (!posted.ok) {
      // The old comment is gone and the stored id now dangles; the next
      // refresh's 404-tolerant delete self-heals before reposting.
      log.warn(
        `generate: entry comment post failed (job unaffected) — ${posted.error.message}`,
      );
      return;
    }
    const stored = await repo.pullRequests.setEntryComment(
      pullRequestId,
      posted.value.commentId,
    );
    if (stored === undefined) {
      log.warn(
        `generate: entry comment id not stored (job unaffected) — pull_request ${pullRequestId} not found`,
      );
      // The new comment is untracked: a later run would delete only the OLD
      // stored id and post again, leaving this one behind, two comments.
      // Best-effort delete restores the ONE-comment invariant now.
      const cleanup = await comments.deleteComment(posted.value.commentId);
      if (!cleanup.ok) {
        log.warn(
          `generate: untracked entry comment ${posted.value.commentId} not deleted — ${cleanup.error.message}`,
        );
      }
      return;
    }
    liveEntryCommentId = posted.value.commentId;
  }

  return {
    getCurrentId,
    buildDeepLink,
    remove: removeEntryComment,
    matches: matchesEntryComment,
    refresh: refreshEntryComment,
  };
}
