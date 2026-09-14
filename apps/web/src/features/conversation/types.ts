// Mirrors the JSON conversation contract: optional keys are absent, never null.
// Guards parse at the boundary without adding Zod to the bundle.
// GitHub state names differ from Review Session dispositions; linked-comment bridges them.
import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import type { Mutable, Result as SharedResult, ValueOf } from "types/utils";

type Result<T> = SharedResult<T, string>;

/** GitHub's diff-side wire values (same literals as the submit mapper). */
export const ThreadSides = {
  LEFT: "LEFT",
  RIGHT: "RIGHT",
} as const;
export type ThreadSide = ValueOf<typeof ThreadSides>;

export const ThreadSubjectTypes = {
  LINE: "LINE",
  FILE: "FILE",
} as const;
export type ThreadSubjectType = ValueOf<typeof ThreadSubjectTypes>;

/** Submitted-review states; PENDING never crosses the API (drafts skipped). */
export const ReviewVerdictStates = {
  COMMENTED: "COMMENTED",
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  DISMISSED: "DISMISSED",
} as const;
export type ReviewVerdictState = ValueOf<typeof ReviewVerdictStates>;

export interface ConversationAuthor {
  readonly login: string;
  readonly isBot: boolean;
  /**
   * GitHub-CDN avatar; absent for ghost authors and https-gated at the
   * parse boundary (it lands in an `<img src>`), a non-https value drops
   * the field, never the author.
   */
  readonly avatarUrl?: string;
}

export interface ConversationComment {
  readonly commentId: number;
  readonly author: ConversationAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
  /** The formal review this comment belongs to, the own-comment join key. */
  readonly reviewId?: number;
}

export interface ConversationThread {
  /** Thread identity AND the reply POST's target comment id. */
  readonly rootCommentId: number;
  readonly path: string;
  /** END line on the current diff; absent for outdated/file-level threads. */
  readonly line?: number;
  readonly startLine?: number;
  readonly side?: ThreadSide;
  readonly startSide?: ThreadSide;
  readonly subjectType: ThreadSubjectType;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  /** Anchor-time commit, the revision label for outdated threads. */
  readonly anchorSha?: string;
  readonly comments: readonly ConversationComment[];
  readonly hasMoreComments: boolean;
}

export interface ConversationReview {
  readonly reviewId: number;
  readonly author: ConversationAuthor;
  readonly state: ReviewVerdictState;
  readonly body: string;
  readonly submittedAt?: string;
  readonly url: string;
}

export interface PrLevelComment {
  readonly commentId: number;
  readonly author: ConversationAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
}

export interface PrConversation {
  readonly threads: readonly ConversationThread[];
  readonly reviews: readonly ConversationReview[];
  readonly prComments: readonly PrLevelComment[];
  readonly hasMoreThreads: boolean;
  readonly hasMoreReviews: boolean;
  readonly hasMorePrComments: boolean;
}

// ---------------------------------------------------------------------------
// Guards.
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

const THREAD_SIDES: readonly string[] = Object.values(ThreadSides);
const SUBJECT_TYPES: readonly string[] = Object.values(ThreadSubjectTypes);
const VERDICT_STATES: readonly string[] = Object.values(ReviewVerdictStates);

/** Parse-and-map an author; https-gates `avatarUrl` (img-src defense). */
function parseAuthor(value: unknown): ConversationAuthor | undefined {
  if (
    !isObject(value) ||
    typeof value["login"] !== "string" ||
    typeof value["isBot"] !== "boolean" ||
    !optionalString(value["avatarUrl"])
  ) {
    return undefined;
  }
  const avatarUrl = value["avatarUrl"];
  const safeAvatar =
    avatarUrl !== undefined && avatarUrl.startsWith("https://")
      ? avatarUrl
      : undefined;
  const author: Mutable<ConversationAuthor> = {
    login: value["login"],
    isBot: value["isBot"],
  };

  if (safeAvatar !== undefined) author.avatarUrl = safeAvatar;

  return author;
}

function parseComment(value: unknown): ConversationComment | undefined {
  if (!isObject(value)) return undefined;
  if (!isSafeId(value["commentId"])) return undefined;
  const author = parseAuthor(value["author"]);
  if (author === undefined) return undefined;
  if (typeof value["body"] !== "string") return undefined;
  if (typeof value["createdAt"] !== "string") return undefined;
  if (typeof value["url"] !== "string") return undefined;
  const reviewId = value["reviewId"];
  if (reviewId !== undefined && !isSafeId(reviewId)) return undefined;
  const comment: Mutable<ConversationComment> = {
    commentId: value["commentId"],
    author,
    body: value["body"],
    createdAt: value["createdAt"],
    url: value["url"],
  };

  if (reviewId !== undefined) comment.reviewId = reviewId;

  return comment;
}

function optionalLine(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value > 0)
  );
}

function optionalSide(value: unknown): value is ThreadSide | undefined {
  return (
    value === undefined ||
    (typeof value === "string" && THREAD_SIDES.includes(value))
  );
}

function parseThread(value: unknown): ConversationThread | undefined {
  if (!isObject(value)) return undefined;
  if (!isSafeId(value["rootCommentId"])) return undefined;
  if (typeof value["path"] !== "string") return undefined;
  if (!optionalLine(value["line"])) return undefined;
  if (!optionalLine(value["startLine"])) return undefined;
  if (!optionalSide(value["side"])) return undefined;
  if (!optionalSide(value["startSide"])) return undefined;
  const subjectType = value["subjectType"];
  if (typeof subjectType !== "string" || !SUBJECT_TYPES.includes(subjectType))
    return undefined;
  if (typeof value["isResolved"] !== "boolean") return undefined;
  if (typeof value["isOutdated"] !== "boolean") return undefined;
  if (!optionalString(value["anchorSha"])) return undefined;
  if (typeof value["hasMoreComments"] !== "boolean") return undefined;
  // Contract: `line` is absent ONLY for outdated or file-level threads, a
  // fresh LINE thread without a line would silently unanchor, a FILE thread
  // WITH one would place inline.
  const isFileLevel = subjectType === ThreadSubjectTypes.FILE;
  if (isFileLevel && value["line"] !== undefined) return undefined;
  if (!isFileLevel && !value["isOutdated"] && value["line"] === undefined) {
    return undefined;
  }
  const rawComments = value["comments"];
  if (!Array.isArray(rawComments) || rawComments.length === 0) return undefined;
  const comments: ConversationComment[] = [];
  for (const raw of rawComments) {
    const comment = parseComment(raw);
    if (comment === undefined) return undefined;
    comments.push(comment);
  }
  // The root id IS the reply target: it must be the first comment shown,
  // or a reply would land on a different comment than the displayed thread.
  if (comments[0]?.commentId !== value["rootCommentId"]) return undefined;
  const thread: Mutable<ConversationThread> = {
    rootCommentId: value["rootCommentId"],
    path: value["path"],
    // `includes` narrowed the literal above.
    subjectType: subjectType === ThreadSubjectTypes.FILE ? "FILE" : "LINE",
    isResolved: value["isResolved"],
    isOutdated: value["isOutdated"],
    comments,
    hasMoreComments: value["hasMoreComments"],
  };

  if (value["line"] !== undefined) thread.line = value["line"];
  if (value["startLine"] !== undefined) thread.startLine = value["startLine"];
  if (value["side"] !== undefined) thread.side = value["side"];
  if (value["startSide"] !== undefined) thread.startSide = value["startSide"];
  if (value["anchorSha"] !== undefined) thread.anchorSha = value["anchorSha"];

  return thread;
}

function parseReview(value: unknown): ConversationReview | undefined {
  if (!isObject(value)) return undefined;
  if (!isSafeId(value["reviewId"])) return undefined;
  const author = parseAuthor(value["author"]);
  if (author === undefined) return undefined;
  const state = value["state"];
  if (typeof state !== "string" || !VERDICT_STATES.includes(state))
    return undefined;
  if (typeof value["body"] !== "string") return undefined;
  if (!optionalString(value["submittedAt"])) return undefined;
  if (typeof value["url"] !== "string") return undefined;
  const review: Mutable<ConversationReview> = {
    reviewId: value["reviewId"],
    author,
    state:
      state === ReviewVerdictStates.APPROVED ||
      state === ReviewVerdictStates.CHANGES_REQUESTED ||
      state === ReviewVerdictStates.DISMISSED
        ? state
        : ReviewVerdictStates.COMMENTED,
    body: value["body"],
    url: value["url"],
  };

  if (value["submittedAt"] !== undefined) {
    review.submittedAt = value["submittedAt"];
  }

  return review;
}

function parsePrLevelComment(value: unknown): PrLevelComment | undefined {
  if (!isObject(value)) return undefined;
  if (!isSafeId(value["commentId"])) return undefined;
  const author = parseAuthor(value["author"]);
  if (author === undefined) return undefined;
  if (typeof value["body"] !== "string") return undefined;
  if (typeof value["createdAt"] !== "string") return undefined;
  if (typeof value["url"] !== "string") return undefined;
  return {
    commentId: value["commentId"],
    author,
    body: value["body"],
    createdAt: value["createdAt"],
    url: value["url"],
  };
}

/**
 * Parse the collaborators GET's body into mention candidates; `ok: false` =
 * contract violation. `hasMore` is parsed but not surfaced, a truncated pool
 * is still a pool. `avatarUrl` is https-gated: a non-https value drops the
 * FIELD (the entry stays), since the string lands in an `<img src>`.
 */
export function parseCollaborators(
  value: unknown,
): Result<readonly MentionCandidate[]> {
  if (!isObject(value))
    return { ok: false, error: "collaborators: not an object" };
  const raw = value["collaborators"];
  if (!Array.isArray(raw))
    return { ok: false, error: "collaborators: collaborators" };
  if (typeof value["hasMore"] !== "boolean")
    return { ok: false, error: "collaborators: hasMore" };
  const candidates: MentionCandidate[] = [];
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry["login"] !== "string")
      return { ok: false, error: "collaborators: entry shape" };
    const name = entry["name"];
    const avatarUrl = entry["avatarUrl"];
    if (!optionalString(name) || !optionalString(avatarUrl))
      return { ok: false, error: "collaborators: entry shape" };
    const safeAvatar =
      avatarUrl !== undefined && avatarUrl.startsWith("https://")
        ? avatarUrl
        : undefined;
    const candidate: Mutable<MentionCandidate> = { login: entry["login"] };

    if (name !== undefined) candidate.name = name;
    if (safeAvatar !== undefined) candidate.avatarUrl = safeAvatar;

    candidates.push(candidate);
  }
  return { ok: true, value: candidates };
}

/** Parse the conversation GET's body; `ok: false` = contract violation. */
export function parseConversation(value: unknown): Result<PrConversation> {
  if (!isObject(value))
    return { ok: false, error: "conversation: not an object" };
  const rawThreads = value["threads"];
  const rawReviews = value["reviews"];
  const rawPrComments = value["prComments"];
  if (!Array.isArray(rawThreads))
    return { ok: false, error: "conversation: threads" };
  if (!Array.isArray(rawReviews))
    return { ok: false, error: "conversation: reviews" };
  if (!Array.isArray(rawPrComments))
    return { ok: false, error: "conversation: prComments" };
  if (
    typeof value["hasMoreThreads"] !== "boolean" ||
    typeof value["hasMoreReviews"] !== "boolean" ||
    typeof value["hasMorePrComments"] !== "boolean"
  ) {
    return { ok: false, error: "conversation: overflow flags" };
  }
  const threads: ConversationThread[] = [];
  for (const raw of rawThreads) {
    const thread = parseThread(raw);
    if (thread === undefined)
      return { ok: false, error: "conversation: thread shape" };
    threads.push(thread);
  }
  const reviews: ConversationReview[] = [];
  for (const raw of rawReviews) {
    const review = parseReview(raw);
    if (review === undefined)
      return { ok: false, error: "conversation: review shape" };
    reviews.push(review);
  }
  const prComments: PrLevelComment[] = [];
  for (const raw of rawPrComments) {
    const comment = parsePrLevelComment(raw);
    if (comment === undefined)
      return { ok: false, error: "conversation: pr comment shape" };
    prComments.push(comment);
  }
  return {
    ok: true,
    value: {
      threads,
      reviews,
      prComments,
      hasMoreThreads: value["hasMoreThreads"],
      hasMoreReviews: value["hasMoreReviews"],
      hasMorePrComments: value["hasMorePrComments"],
    },
  };
}
