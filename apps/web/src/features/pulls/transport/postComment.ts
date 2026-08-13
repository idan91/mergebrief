// Inline post-now transport: posts one staged draft comment immediately as a
// standalone inline review comment (own-draft state only). Expected failure
// statuses are RESULT KINDS the own-draft flow renders as toast copy — only a
// malformed 2xx throws (contract violation).
//
// Deterministic-400 mirroring: the route rejects an empty or over-long body, a
// non-40-hex commitId, and startLine >= line. Client mirrors: the composer
// blocks an empty body at save time; the over-long body is blocked at the Post
// affordance by `postCommentBlockedReason` (keep in lockstep with the route's
// MAX_BODY_LENGTH); the commitId is always the viewed head; the anchor→wire map
// only sets startLine on a true multi-line range. A 400 that still lands
// collapses to `invalid`, whose copy tells the author to edit the draft — never
// a retry-as-is invitation.
import { useSyncExternalStore } from "react";

import {
  ApiError,
  ApiErrorCode,
  apiFetch,
  errorFromResponse,
} from "../../../data/apiFetch";
import { markSnapshotCommentsSubmitted } from "../../review/session";
import type { WireSide } from "../../review/utils/submit";

export type PostCommentResult =
  /** 201 — posted; `reviewId` is the wrapping review id when GitHub assigns one. */
  | {
      readonly kind: "posted";
      readonly commentId: number;
      readonly reviewId?: number;
    }
  /** 401 — session expired; sign in again. The draft stays. */
  | { readonly kind: "unauthorized" }
  /** 404 — the PR (or repo access) is gone. */
  | { readonly kind: "not-found" }
  /** 409 — the head advanced under the pinned commit; reload to re-anchor. */
  | { readonly kind: "stale" }
  /** 400 — the route rejected the shape (mirrored client-side; programmer error). */
  | { readonly kind: "invalid" }
  /** 502/anything else — GitHub rejected or is unreachable. */
  | { readonly kind: "upstream" };

export interface PostCommentPayload {
  /** The head the anchor was read against — pins the comment to that diff. */
  readonly commitId: string;
  readonly path: string;
  readonly line: number;
  readonly side: WireSide;
  readonly startLine?: number;
  readonly startSide?: WireSide;
  readonly body: string;
}

function isPostedBody(
  value: unknown,
): value is { commentId: number; reviewId?: number } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("commentId" in value) ||
    typeof value.commentId !== "number" ||
    !Number.isSafeInteger(value.commentId)
  ) {
    return false;
  }
  if ("reviewId" in value && value.reviewId !== undefined) {
    return (
      typeof value.reviewId === "number" && Number.isSafeInteger(value.reviewId)
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// In-flight post registry — MODULE-LEVEL, keyed briefId × commentId.
//
// The in-flight window must outlive mounts: per-mount state resets on a
// same-tab remount (e.g. a route re-entry) while the fetch closure
// survives, so Submit review would ship the still-draft comment and the
// settling 201 would flip it only afterwards — a duplicate on GitHub.
// Components subscribe for re-render.
//
// Per-TAB only: cross-tab dedupe would need a server-side idempotency key.
// ---------------------------------------------------------------------------

/** briefId → the commentIds with a post-now request currently in flight. */
const inFlightPosts = new Map<string, Set<string>>();
const inFlightListeners = new Set<() => void>();
const EMPTY_POSTING_IDS: ReadonlySet<string> = new Set();
/**
 * Per-brief snapshot cache: `useSyncExternalStore` requires `getSnapshot` to
 * return a STABLE reference between notifications (a fresh Set every call
 * would render-loop). Invalidated wholesale on every mutation.
 */
let inFlightSnapshots = new Map<string, ReadonlySet<string>>();

function notifyInFlightPosts(): void {
  inFlightSnapshots = new Map();
  for (const listener of inFlightListeners) {
    listener();
  }
}

/**
 * Mark a post as in flight. Returns false when this briefId × commentId is
 * ALREADY in flight — the synchronous re-entrancy gate (module state, not a
 * ref: it survives the remount that resets component state).
 */
export function beginInFlightPost(briefId: string, commentId: string): boolean {
  const ids = inFlightPosts.get(briefId) ?? new Set<string>();
  if (ids.has(commentId)) {
    return false;
  }
  ids.add(commentId);
  inFlightPosts.set(briefId, ids);
  notifyInFlightPosts();
  return true;
}

/** Settle a post (success or failure) — always called from the fetch closure's finally. */
export function endInFlightPost(briefId: string, commentId: string): void {
  const ids = inFlightPosts.get(briefId);
  if (ids === undefined || !ids.delete(commentId)) {
    return;
  }
  if (ids.size === 0) {
    inFlightPosts.delete(briefId);
  }
  notifyInFlightPosts();
}

function subscribeInFlightPosts(listener: () => void): () => void {
  inFlightListeners.add(listener);
  return () => {
    inFlightListeners.delete(listener);
  };
}

/** The brief's in-flight commentIds — stable reference between mutations. */
export function getInFlightPosts(briefId: string): ReadonlySet<string> {
  let snapshot = inFlightSnapshots.get(briefId);
  if (snapshot === undefined) {
    const ids = inFlightPosts.get(briefId);
    // A FRESH reference after every notification, even empty → empty:
    // `recordPostNotice` rides this channel to wake the drain effect, and a
    // shared empty set would let React bail out of the re-render.
    snapshot = new Set(ids ?? []);
    inFlightSnapshots.set(briefId, snapshot);
  }
  return snapshot;
}

/**
 * Subscribe a component to the brief's in-flight post set. A fresh mount with
 * the same briefId sees every still-unsettled post immediately; SSR sees the
 * empty set.
 */
export function useInFlightPosts(briefId: string): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeInFlightPosts,
    () => getInFlightPosts(briefId),
    () => EMPTY_POSTING_IDS,
  );
}

/** Live-store half of the posted-comment commit. */
export interface PostedCommentStoreActions {
  markCommentsSubmitted(ids: readonly string[]): void;
  recordSubmittedReview(reviewId: number): void;
}

/**
 * A settled post-now outcome awaiting the live mount. `posted` carries the
 * live-store flip payload; `failed` carries only its copy. EVERY outcome is
 * announced by the DRAINING mount: the settling closure's captured announce
 * targets the mount that STARTED the post, so after a remount-mid-flight a
 * direct announce is a no-op — and a dropped indeterminate "may or may not
 * have posted" warning leaves a re-enabled Post button inviting a double-post.
 */
type SettledPost =
  | {
      readonly kind: "posted";
      readonly commentId: string;
      readonly reviewId: number | undefined;
      /** `null` = the initiator owns messaging (batch): flip silently. */
      readonly announceCopy: string | null;
    }
  | {
      readonly kind: "failed";
      readonly commentId: string;
      /** `null` = the initiator owns messaging (batch): no drain announce. */
      readonly announceCopy: string | null;
    }
  /**
   * A batch-level message (the mark-ready batch's stop-the-run summary): no
   * store effect, announced LAST by the drain so it is the live-region write
   * that survives. Queued for the same remount-independence as per-comment
   * failures — a remount-mid-batch would otherwise drop it silently, since the
   * batch's per-comment entries are suppressed.
   */
  | {
      readonly kind: "notice";
      readonly announceCopy: string;
    };

/**
 * briefId → settled outcomes awaiting the live mount. MODULE-LEVEL because the
 * settling closure captured the STORE (and toast) OF THE MOUNT THAT STARTED IT:
 * after a same-tab remount, applying through the captured actions flips the
 * ORPHANED store, the new store's next whole-state flush clobbers the durable
 * snapshot flip, and both Submit review and a re-enabled Post button
 * double-post. Draining through the CURRENT mount (`applySettledPosts`) closes
 * that window for the store flips AND the announcements.
 */
const settledPosts = new Map<string, SettledPost[]>();

function pushSettledPost(briefId: string, entry: SettledPost): void {
  const queue = settledPosts.get(briefId) ?? [];
  queue.push(entry);
  settledPosts.set(briefId, queue);
}

/**
 * Commit a confirmed post — the parts that must not depend on any mount:
 *
 * - durable snapshot: flip + review id written straight to sessionStorage, so
 *   success persists independent of component lifetime;
 * - settled queue: the live-store flip AND the success announcement are
 *   RECORDED, not applied — whichever BriefScreen is mounted at settle time
 *   drains them, so both land on the LIVE screen, never an orphan.
 *
 * Best-effort past the commit point: the comment IS on GitHub, so a local
 * persistence failure logs, never throws — and the queue push happens anyway.
 *
 * `announceCopy: null` = the INITIATOR owns messaging (the mark-ready batch):
 * the drain applies the store flips but announces nothing, so the batch's
 * summary toast stays the last live-region write.
 */
export function commitPostedComment(
  briefId: string,
  commentId: string,
  reviewId: number | undefined,
  announceCopy: string | null,
): void {
  try {
    markSnapshotCommentsSubmitted(briefId, [commentId], false, reviewId);
  } catch (persistError) {
    console.error("post-now: durable persistence failed", persistError);
  }
  pushSettledPost(briefId, {
    kind: "posted",
    commentId,
    reviewId,
    announceCopy,
  });
}

/**
 * Record a FAILED (or indeterminate) post outcome for the live mount to
 * announce. No store or snapshot effect — the draft stays a draft — but the
 * copy must reach whichever screen is up: the indeterminate "may or may not
 * have posted" warning is what stands between a re-enabled Post button and a
 * blind double-posting retry.
 *
 * `announceCopy: null` = the INITIATOR owns messaging (the mark-ready batch):
 * its summary carries the indeterminate warning, and the drain must not
 * overwrite it with per-comment copy.
 */
export function recordFailedPost(
  briefId: string,
  commentId: string,
  announceCopy: string | null,
): void {
  pushSettledPost(briefId, { kind: "failed", commentId, announceCopy });
}

/**
 * Record a batch-level message for the LIVE mount to announce after every
 * per-comment entry. Notifies the in-flight subscribers so the drain effect
 * runs even when the notice is recorded without an in-flight transition (a
 * guard-path failure never touched the registry).
 */
export function recordPostNotice(briefId: string, announceCopy: string): void {
  pushSettledPost(briefId, { kind: "notice", announceCopy });
  notifyInFlightPosts();
}

/**
 * Drain the brief's settled outcomes into the CURRENT mount: posted entries
 * flip the live store (and record the "yours" join key), then EVERY entry's
 * copy goes through the live region. The closure announces nothing directly,
 * so the common no-remount case announces exactly once. Called from
 * BriefScreen's effect on mount and on every in-flight change. Idempotent: the
 * queue is cleared up front, the store no-ops repeat flips, and review-id
 * recording dedupes.
 */
export function applySettledPosts(
  briefId: string,
  actions: PostedCommentStoreActions,
  announce: (message: string) => void,
): void {
  const queue = settledPosts.get(briefId);
  if (queue === undefined || queue.length === 0) {
    return;
  }
  settledPosts.delete(briefId);
  const posted = queue.filter((entry) => entry.kind === "posted");
  try {
    if (posted.length > 0) {
      actions.markCommentsSubmitted(posted.map((entry) => entry.commentId));
      for (const entry of posted) {
        if (entry.reviewId !== undefined) {
          actions.recordSubmittedReview(entry.reviewId);
        }
      }
    }
  } catch (storeError) {
    // Best-effort: the durable snapshot already holds the flips; a live-store
    // failure must never surface as an error (the comment IS on GitHub).
    console.error("post-now: live-store flip failed", storeError);
  }
  // Announce AFTER the flips so success copy never precedes its state. The
  // clear-then-set live region reads the LAST message, so failures announce
  // after successes — their "may or may not have posted — check GitHub"
  // warning must win a concurrent settle — and batch notices last of all, so
  // the batch summary is the write that survives. Null copy = the initiator
  // owns messaging: flip above, announce nothing here.
  const ordered = [
    ...queue.filter((entry) => entry.kind === "posted"),
    ...queue.filter((entry) => entry.kind === "failed"),
    ...queue.filter((entry) => entry.kind === "notice"),
  ];
  for (const entry of ordered) {
    if (entry.announceCopy !== null) {
      announce(entry.announceCopy);
    }
  }
}

export async function postInlineComment(
  repoId: string,
  prNumber: number,
  payload: PostCommentPayload,
): Promise<PostCommentResult> {
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/comments`;
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const { code } = await errorFromResponse(response, path);
    if (code === ApiErrorCode.UNAUTHORIZED) return { kind: "unauthorized" };
    if (code === ApiErrorCode.NOT_FOUND) return { kind: "not-found" };
    // Either 409 code maps to stale: this route only ever emits
    // pr-changed-since-read, so a rewritten code here is the codeless-409
    // fallback ambiguity, and reload-to-re-anchor is right for both.
    if (
      code === ApiErrorCode.PR_CHANGED_SINCE_READ ||
      code === ApiErrorCode.PR_REWRITTEN_SINCE_READ
    ) {
      return { kind: "stale" };
    }
    if (code === ApiErrorCode.INVALID_REQUEST) return { kind: "invalid" };
    return { kind: "upstream" };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
  }
  if (!isPostedBody(parsed)) {
    throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
  }
  return {
    kind: "posted",
    commentId: parsed.commentId,
    ...(parsed.reviewId === undefined ? {} : { reviewId: parsed.reviewId }),
  };
}
