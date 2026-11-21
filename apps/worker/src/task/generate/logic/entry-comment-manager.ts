import {
  GitHubApiErrorCodes,
  isPermanentGitHubError,
  type GitHubCallFailure,
  type IssueComment,
} from "github";
import {
  EntryCommentSwapErrorCodes,
  type EntryCommentSwapError,
  type PullRequestRow,
} from "persistence";
import type { Result } from "types/utils";
import { isEntryCommentBody } from "../../entry-comment";
import type { EntryCommentLink } from "../../entry-comment/types";
import type { ParsedGeneratePayload } from "../../payload";
import {
  EntryWrites,
  LiveBodyKinds,
  type EntryCommentManager,
  type EntryCommentManagerInputs,
  type EntryWrite,
  type LiveBody,
  type LiveBodyMatcher,
} from "../types";

const REQUIRED_WRITE_PERMISSION = "Pull requests: write";

function isOrphanedEntryComment(
  comment: IssueComment,
  tracked: IssueComment,
): boolean {
  const older = comment.commentId < tracked.commentId;
  const sameAuthor = comment.authorId === tracked.authorId;
  const orphaned = older && sameAuthor && isEntryCommentBody(comment.body);
  return orphaned;
}

/** The job still succeeds and no UI reports this, so the log line is the operator's only signal. */
function describeWriteFailure(error: GitHubCallFailure): string {
  if (error.code === GitHubApiErrorCodes.FORBIDDEN) {
    return `${error.message}; check the App has ${REQUIRED_WRITE_PERMISSION}, accepted on its installation`;
  }
  return error.message;
}

function classifyFailedWrite(error: GitHubCallFailure): EntryWrite {
  if (isPermanentGitHubError(error)) {
    return EntryWrites.REFUSED;
  }
  return EntryWrites.FAILED;
}

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

  /**
   * An adopted comment is another run's, replaced only once a fresh head read
   * names this run's head: a moved head leaves it, and an unread one leaves
   * it to the head's sync, which reads the head again. `undefined` lets the
   * post go on.
   */
  async function resolveAdoptedCommentWrite(): Promise<EntryWrite | undefined> {
    const adopted =
      liveEntryCommentId !== null &&
      liveEntryCommentId === adoptedEntryCommentId;
    if (!adopted) {
      return undefined;
    }
    const read = await source.fetchPullRequest();
    if (!read.ok) {
      log.info("generate: head unread, leaving another run's entry comment");
      return EntryWrites.CONFLICTED;
    }
    if (read.value.headSha !== headSha) {
      log.info("generate: head moved, leaving another run's entry comment");
      return EntryWrites.LEFT;
    }
    return undefined;
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
        `generate: stale entry comment delete failed (job unaffected) — ${describeWriteFailure(deleted.error)}`,
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
      return {
        kind: LiveBodyKinds.UNREAD,
        refused: isPermanentGitHubError(fetched.error),
      };
    }
    if (fetched.value === undefined) {
      return { kind: LiveBodyKinds.NONE };
    }
    return { kind: LiveBodyKinds.READ, body: fetched.value.body };
  }

  async function replaceOrCreateEntryComment(
    body: string,
    isReplaceable: LiveBodyMatcher,
  ): Promise<EntryWrite> {
    return settleEntryComment(body, isReplaceable, true, refreshEntryComment);
  }

  async function editOrCreateEntryComment(
    body: string,
    isReplaceable: LiveBodyMatcher,
  ): Promise<EntryWrite> {
    return settleEntryComment(body, isReplaceable, true, editEntryComment);
  }

  async function editOrRefreshEntryComment(
    body: string,
    isEditable: LiveBodyMatcher,
  ): Promise<EntryWrite> {
    const live = await readLiveBody();
    const editable = live.kind === LiveBodyKinds.READ && isEditable(live.body);
    if (editable) {
      return editEntryComment(body);
    }
    return refreshEntryComment(body);
  }

  async function replaceEntryComment(
    body: string,
    isReplaceable: LiveBodyMatcher,
  ): Promise<EntryWrite> {
    return settleEntryComment(body, isReplaceable, false, refreshEntryComment);
  }

  async function editMatchingEntryComment(
    body: string,
    isEditable: LiveBodyMatcher,
  ): Promise<EntryWrite> {
    return settleEntryComment(body, isEditable, false, editEntryComment);
  }

  async function settleEntryComment(
    body: string,
    isReplaceable: LiveBodyMatcher,
    createsComment: boolean,
    rewrite: (body: string) => Promise<EntryWrite>,
  ): Promise<EntryWrite> {
    const live = await readLiveBody();
    if (live.kind === LiveBodyKinds.UNREAD) {
      return live.refused ? EntryWrites.REFUSED : EntryWrites.FAILED;
    }
    if (live.kind === LiveBodyKinds.NONE) {
      if (createsComment) {
        return createUnlessAnotherRunPosted(body);
      }
      return EntryWrites.LEFT;
    }
    if (live.body === body) {
      return EntryWrites.LEFT;
    }
    if (isReplaceable(live.body)) {
      return rewrite(body);
    }
    log.info("generate: entry comment holds another body, leaving it");
    return EntryWrites.LEFT;
  }

  /**
   * A newer head's run may have posted since this run opened: an id on the
   * row this run never knew means the thread already has its one Entry
   * comment, a body this run never read. An id it knew, gone or left
   * dangling by its own failed repost, is this run's to replace.
   */
  async function createUnlessAnotherRunPosted(
    body: string,
  ): Promise<EntryWrite> {
    const row = await repo.pullRequests.getById(pullRequestId);
    if (row === undefined) {
      return EntryWrites.LEFT;
    }
    const postedByAnotherRun =
      row.entryCommentId !== null && !knownIds.has(row.entryCommentId);
    if (postedByAnotherRun) {
      log.info("generate: the PR row tracks another entry comment, leaving it");
      return EntryWrites.CONFLICTED;
    }
    return refreshEntryComment(body);
  }

  /**
   * Delete/repost rotates the one Entry id and supplies the ready notification ping.
   * The adapter treats already-deleted ids as success. GitHub failures warn and leave the
   * job alone; a later settled head can retry the cycle. A storage throw from the id swap
   * deletes the comment just posted, then propagates as an infra error.
   */
  async function refreshEntryComment(body: string): Promise<EntryWrite> {
    if (comments === undefined) {
      return EntryWrites.LEFT;
    }
    const adoptedWrite = await resolveAdoptedCommentWrite();
    if (adoptedWrite !== undefined) {
      return adoptedWrite;
    }
    if (liveEntryCommentId !== null) {
      const deleted = await comments.deleteComment(liveEntryCommentId);
      if (!deleted.ok) {
        // Skip the repost: posting past a live comment we failed to delete
        // would leave two. The stored id survives for the next run's retry.
        log.warn(
          `generate: entry comment delete failed (job unaffected) — ${describeWriteFailure(deleted.error)}`,
        );
        return classifyFailedWrite(deleted.error);
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
        `generate: entry comment post failed (job unaffected) — ${describeWriteFailure(posted.error)}`,
      );
      return classifyFailedWrite(posted.error);
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
        return EntryWrites.CONFLICTED;
      }
      log.warn(
        `generate: entry comment id not stored (job unaffected), pull_request ${pullRequestId} not found`,
      );
      return EntryWrites.LEFT;
    }
    trackPostedEntryComment(posted.value.commentId);
    await deleteOrphanedEntryComments(posted.value.commentId);
    return EntryWrites.WRITTEN;
  }

  async function editEntryComment(body: string): Promise<EntryWrite> {
    if (comments === undefined) {
      return EntryWrites.LEFT;
    }
    if (liveEntryCommentId === null) {
      return refreshEntryComment(body);
    }
    const adoptedWrite = await resolveAdoptedCommentWrite();
    if (adoptedWrite !== undefined) {
      return adoptedWrite;
    }

    const edited = await comments.editComment(liveEntryCommentId, body);
    if (!edited.ok) {
      log.warn(
        `generate: entry comment edit failed (job unaffected), ${describeWriteFailure(edited.error)}`,
      );
      return classifyFailedWrite(edited.error);
    }
    if (!edited.value) {
      return refreshEntryComment(body);
    }
    return EntryWrites.WRITTEN;
  }

  /**
   * A run killed between its post and its id swap leaves that comment
   * untracked, so each tracked post deletes the Entry comments older than it
   * that its own author left on the PR. Only older ones: a newer one is a
   * later run's, mid-swap. Best-effort, a failure only warns.
   */
  async function deleteOrphanedEntryComments(trackedId: bigint): Promise<void> {
    if (comments === undefined) {
      return;
    }
    const listed = await comments.listIssueComments(prRow.prNumber);
    if (!listed.ok) {
      log.warn(
        `generate: entry comment listing failed, orphans kept, ${listed.error.message}`,
      );
      return;
    }
    const tracked = listed.value.find(
      (comment) => comment.commentId === trackedId,
    );
    if (tracked?.authorId === undefined) {
      return;
    }

    const orphans = listed.value.filter((comment) =>
      isOrphanedEntryComment(comment, tracked),
    );
    for (const orphan of orphans) {
      // oxlint-disable-next-line no-await-in-loop -- deletes go one at a time, as every comment write does
      await deleteUntrackedEntryComment(orphan.commentId);
    }
    if (orphans.length > 0) {
      log.info("generate: deleted entry comments an earlier run left", {
        count: orphans.length,
      });
    }
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
    edit: editEntryComment,
    replaceOrCreate: replaceOrCreateEntryComment,
    editOrCreate: editOrCreateEntryComment,
    replace: replaceEntryComment,
    editMatching: editMatchingEntryComment,
    editOrRefresh: editOrRefreshEntryComment,
  };
}
