import {
  type Activity,
  ActivityKinds,
  type Author,
  type OpenThread,
  type PullSnapshot,
  type ReviewThread,
} from "../types";

const UNKNOWN_AUTHOR = "ghost";

function getLogin(author: Author | undefined): string {
  return author?.login ?? UNKNOWN_AUTHOR;
}

/**
 * Open = unresolved and its last message is not a reply this tool recorded.
 * Author is no signal: agents and the maintainer post under the same login.
 */
export function deriveOpenThreads(
  threads: readonly ReviewThread[],
  replyIds: ReadonlySet<number>,
): OpenThread[] {
  const open: OpenThread[] = [];
  for (const thread of threads) {
    const root = thread.comments[0];
    const last = thread.comments.at(-1);
    if (thread.isResolved || root === undefined || last === undefined) {
      continue;
    }
    if (replyIds.has(last.id)) {
      continue;
    }
    open.push({
      rootId: root.id,
      path: root.path,
      line: root.line,
      lastAuthor: getLogin(last.author),
      lastAt: last.createdAt,
      isOutdated: thread.isOutdated,
    });
  }
  return open;
}

function isAfter(at: string | undefined, reference: string): boolean {
  return at !== undefined && Date.parse(at) > Date.parse(reference);
}

/** Reviews and PR comments that landed after the head commit, minus bots and our own replies. */
export function deriveActivityAfterHead(
  pull: PullSnapshot,
  replyIds: ReadonlySet<number>,
): Activity[] {
  const activity: Activity[] = [];
  for (const review of pull.reviews) {
    const onlyOurReplies =
      review.commentIds.length > 0 &&
      review.commentIds.every((id) => replyIds.has(id));
    const counts =
      isAfter(review.submittedAt, pull.headCommittedAt) &&
      review.author?.isBot !== true &&
      !onlyOurReplies;
    if (counts && review.submittedAt !== undefined) {
      activity.push({
        kind: ActivityKinds.REVIEW,
        author: getLogin(review.author),
        at: review.submittedAt,
        state: review.state,
      });
    }
  }
  for (const comment of pull.issueComments) {
    const counts =
      isAfter(comment.createdAt, pull.headCommittedAt) &&
      comment.author?.isBot !== true;
    if (counts) {
      activity.push({
        kind: ActivityKinds.COMMENT,
        author: getLogin(comment.author),
        at: comment.createdAt,
      });
    }
  }
  return activity.toSorted(
    (left, right) => Date.parse(left.at) - Date.parse(right.at),
  );
}
