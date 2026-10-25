import {
  EntryCommentSwapErrorCodes,
  type EntryCommentSwapError,
  type PullRequestRow,
} from "persistence";
import type { Result } from "types/utils";
import type { EntryCommentLink } from "../../entry-comment";
import type { ParsedGeneratePayload } from "../../payload";
import {
  LiveBodyKinds,
  type EntryCommentManager,
  type EntryCommentManagerInputs,
  type LiveBody,
} from "../types";

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
  // The id this run last saw on the row; every write swaps from it.
  let storedEntryCommentId: bigint | null = prRow.entryCommentId;
  // Every id this run opened on or posted; any other id on the row is a newer run's.
  const knownIds = new Set<bigint>();
  if (prRow.entryCommentId !== null) {
    knownIds.add(prRow.entryCommentId);
  }

  // Taken from the row after a lost swap; it may be a newer head's comment.
  let adoptedEntryCommentId: bigint | null = null;

  /**
   * A lost swap means the row moved on: track the id it holds now as live,
   * never as known, so this run's next post replaces it instead of losing to
   * it again.
   */
  function adoptRowEntryComment(entryCommentId: bigint | null): void {
    storedEntryCommentId = entryCommentId;
    liveEntryCommentId = entryCommentId;
    adoptedEntryCommentId = entryCommentId;
  }

  /** Fail-closed: a failed read is a moved head. */
  async function isOwnHeadConfirmed(): Promise<boolean> {
    const read = await source.fetchPullRequest();
    const ownHead = read.ok && read.value.headSha === headSha;
    return ownHead;
  }

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
    const cleared = await repo.pullRequests.swapEntryComment(pullRequestId, {
      seen: storedEntryCommentId,
      next: null,
    });
    if (!cleared.ok) {
      if (cleared.error.code === EntryCommentSwapErrorCodes.SWAP_LOST) {
        log.info("generate: another run stored an entry comment, leaving it");
        return;
      }
      log.warn(
        `generate: entry comment id not cleared (job unaffected), pull_request ${pullRequestId} not found`,
      );
      return;
    }
    storedEntryCommentId = null;
  }

  /**
   * True when the tracked Entry comment exists and its live body already
   * equals `body`. Any uncertainty (no tracked id, comment gone, fetch
   * failure) reports false so the caller falls back to the delete+repost
   * cycle, the self-heals stay intact.
   */
  async function matchesEntryComment(body: string): Promise<boolean> {
    const live = await readLiveBody();
    const matches = live.kind === LiveBodyKinds.READ && live.body === body;
    return matches;
  }

  /** The tracked comment's body; `none` when nothing is tracked or it is gone. */
  async function readLiveBody(): Promise<LiveBody> {
    if (comments === undefined || liveEntryCommentId === null) {
      return { kind: LiveBodyKinds.NONE };
    }
    const fetched = await comments.fetchComment(liveEntryCommentId);
    if (!fetched.ok) {
      log.warn(
        `generate: entry comment fetch failed (job unaffected) — ${fetched.error.message}`,
      );
      return { kind: LiveBodyKinds.UNREAD };
    }
    if (fetched.value === undefined) {
      return { kind: LiveBodyKinds.NONE };
    }
    return { kind: LiveBodyKinds.READ, body: fetched.value.body };
  }

  async function replaceOrCreateEntryComment(
    body: string,
    replaceable: readonly string[],
  ): Promise<void> {
    await settleEntryComment(body, replaceable, true);
  }

  async function replaceEntryComment(
    body: string,
    replaceable: readonly string[],
  ): Promise<void> {
    await settleEntryComment(body, replaceable, false);
  }

  async function settleEntryComment(
    body: string,
    replaceable: readonly string[],
    createsComment: boolean,
  ): Promise<void> {
    const live = await readLiveBody();
    if (live.kind === LiveBodyKinds.NONE) {
      if (createsComment) {
        await createUnlessAnotherRunPosted(body);
      }
      return;
    }
    const leftAsIs = live.kind === LiveBodyKinds.UNREAD || live.body === body;
    if (leftAsIs) {
      return;
    }
    if (replaceable.includes(live.body)) {
      await refreshEntryComment(body);
      return;
    }
    log.info("generate: entry comment holds another body, leaving it");
  }

  /**
   * A newer head's run may have posted since this run opened: an id on the
   * row this run never knew means the thread already has its one Entry
   * comment. An id it knew, gone or left dangling by its own failed repost,
   * is this run's to replace.
   */
  async function createUnlessAnotherRunPosted(body: string): Promise<void> {
    const row = await repo.pullRequests.getById(pullRequestId);
    if (row === undefined) {
      return;
    }
    const postedByAnotherRun =
      row.entryCommentId !== null && !knownIds.has(row.entryCommentId);
    if (postedByAnotherRun) {
      log.info("generate: the PR row tracks another entry comment, leaving it");
      return;
    }
    await refreshEntryComment(body);
  }

  /**
   * Delete/repost rotates the one Entry id and supplies the ready notification ping.
   * The adapter treats already-deleted ids as success. GitHub failures warn and leave the
   * job alone; a later settled head can retry the cycle. A storage throw from the id swap
   * deletes the comment just posted, then propagates as an infra error.
   */
  async function refreshEntryComment(body: string): Promise<void> {
    if (comments === undefined) {
      return;
    }
    if (liveEntryCommentId !== null) {
      const adopted = liveEntryCommentId === adoptedEntryCommentId;
      const adoptedUnconfirmed = adopted && !(await isOwnHeadConfirmed());
      if (adoptedUnconfirmed) {
        log.info(
          "generate: head unconfirmed, leaving another run's entry comment",
        );
        return;
      }
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
    const stored = await swapPostedEntryComment(posted.value.commentId);
    if (!stored.ok) {
      // The new comment is untracked: it goes first, and the row's one stays.
      await deleteUntrackedEntryComment(posted.value.commentId);
      if (stored.error.code === EntryCommentSwapErrorCodes.SWAP_LOST) {
        adoptRowEntryComment(stored.error.entryCommentId);
        log.info(
          "generate: another run stored its entry comment first, this run's was deleted",
        );
        return;
      }
      log.warn(
        `generate: entry comment id not stored (job unaffected), pull_request ${pullRequestId} not found`,
      );
      return;
    }
    trackPostedEntryComment(posted.value.commentId);
  }

  function trackPostedEntryComment(commentId: bigint): void {
    liveEntryCommentId = commentId;
    storedEntryCommentId = commentId;
    adoptedEntryCommentId = null;
    knownIds.add(commentId);
  }

  /**
   * A swap that throws leaves the comment just posted untracked, so it goes
   * first, unless the row already names it: the swap committed and only its
   * answer was lost, so the run tracks it as its own.
   */
  async function swapPostedEntryComment(
    commentId: bigint,
  ): Promise<Result<PullRequestRow, EntryCommentSwapError>> {
    try {
      return await repo.pullRequests.swapEntryComment(pullRequestId, {
        seen: storedEntryCommentId,
        next: commentId,
      });
    } catch (error) {
      if (await isTrackedOnRow(commentId)) {
        trackPostedEntryComment(commentId);
      } else {
        await deleteUntrackedEntryComment(commentId);
      }
      throw error;
    }
  }

  /** False when the row cannot be read either. */
  async function isTrackedOnRow(commentId: bigint): Promise<boolean> {
    try {
      const row = await repo.pullRequests.getById(pullRequestId);
      return row?.entryCommentId === commentId;
    } catch {
      return false;
    }
  }

  async function deleteUntrackedEntryComment(commentId: bigint): Promise<void> {
    if (comments === undefined) {
      return;
    }
    const cleanup = await comments.deleteComment(commentId);
    if (!cleanup.ok) {
      log.warn(
        `generate: untracked entry comment ${commentId} not deleted — ${cleanup.error.message}`,
      );
    }
  }

  return {
    getCurrentId,
    buildDeepLink,
    remove: removeEntryComment,
    matches: matchesEntryComment,
    refresh: refreshEntryComment,
    replaceOrCreate: replaceOrCreateEntryComment,
    replace: replaceEntryComment,
  };
}
