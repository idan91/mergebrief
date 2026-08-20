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
import {
  ApiError,
  ApiErrorCode,
  apiFetch,
  errorFromResponse,
} from "../../../data/apiFetch";

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
  /** 409 — the draft's anchor points at no code; re-place or delete it. */
  | { readonly kind: "orphaned-anchor" }
  /** 409 — the draft is already on GitHub; nothing posted twice. */
  | { readonly kind: "already-published" }
  /** 400 — the route rejected the shape (mirrored client-side; programmer error). */
  | { readonly kind: "invalid" }
  /** 502/anything else — GitHub rejected or is unreachable. */
  | { readonly kind: "upstream" };

/**
 * The route posts a draft the SESSION holds: the anchor and body are already
 * stored, and the commit comes off the named Brief's head. All this carries
 * is which draft.
 */
export interface PostCommentPayload {
  readonly draftId: string;
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

export async function postInlineComment(
  repoId: string,
  prNumber: number,
  span: { base: string; head: string },
  payload: PostCommentPayload,
): Promise<PostCommentResult> {
  const query = `base=${encodeURIComponent(span.base)}&head=${encodeURIComponent(span.head)}`;
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/comments?${query}`;
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const { code } = await errorFromResponse(response, path);
    if (code === ApiErrorCode.UNAUTHORIZED) return { kind: "unauthorized" };
    if (code === ApiErrorCode.NOT_FOUND) return { kind: "not-found" };
    // Each of this route's 409s is its own outcome. A frozen session and a
    // rewritten PR both mean the read went stale (reload to re-anchor); an
    // orphaned anchor and an already-published draft are neither stale nor
    // retryable, and telling the reviewer "try again shortly" would invite a
    // pointless re-post.
    if (
      code === ApiErrorCode.PR_CHANGED_SINCE_READ ||
      code === ApiErrorCode.PR_REWRITTEN_SINCE_READ
    ) {
      return { kind: "stale" };
    }
    if (code === ApiErrorCode.DRAFT_ANCHOR_ORPHANED) {
      return { kind: "orphaned-anchor" };
    }
    if (code === ApiErrorCode.DRAFT_ALREADY_PUBLISHED) {
      return { kind: "already-published" };
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
