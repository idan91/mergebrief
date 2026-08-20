// Reply transport: replies post IMMEDIATELY with the viewer's token —
// GitHub's create-review comments[] has no in_reply_to, so there is no
// batched alternative. Expected failure statuses are RESULT KINDS the
// composer renders; only a malformed 2xx throws (contract violation).
import {
  ApiError,
  ApiErrorCode,
  apiFetch,
  errorFromResponse,
} from "../../data/apiFetch";

export type ReplyResult =
  | { readonly kind: "posted"; readonly commentId: number }
  /** 401 — session expired; sign in again. Draft stays. */
  | { readonly kind: "unauthorized" }
  /** 404 — the thread's root comment (or the PR) is gone. */
  | { readonly kind: "not-found" }
  /** 400 (shape; mirrored client-side) or deterministic 413 — edit the body, retry-as-is never clears. */
  | { readonly kind: "invalid" }
  /** 502/anything else — GitHub rejected or is unreachable. */
  | { readonly kind: "upstream" };

/** Mirror of the route's Zod cap — a deterministic 400 must block client-side. */
export const MAX_REPLY_LENGTH = 65_536;

type ReplyFailureKind = Exclude<ReplyResult["kind"], "posted">;

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "try again shortly". A 413 is
// deterministic (over-long body): edit, never retry-as-is.
const KIND_FOR_CODE = {
  [ApiErrorCode.UNAUTHORIZED]: "unauthorized",
  [ApiErrorCode.INVALID_SIGNATURE]: "upstream",
  [ApiErrorCode.FORBIDDEN]: "upstream",
  [ApiErrorCode.GITHUB_PERMISSION]: "upstream",
  [ApiErrorCode.SCOPE_EXCEEDED]: "upstream",
  [ApiErrorCode.HUMAN_ONLY]: "upstream",
  [ApiErrorCode.NOT_FOUND]: "not-found",
  [ApiErrorCode.INVALID_REQUEST]: "invalid",
  [ApiErrorCode.NOT_A_PR_URL]: "upstream",
  [ApiErrorCode.SIGN_IN_FAILED]: "upstream",
  [ApiErrorCode.REQUEST_TOO_LARGE]: "invalid",
  [ApiErrorCode.DIFF_TOO_LARGE]: "upstream",
  [ApiErrorCode.DRAFT_ALREADY_PUBLISHED]: "upstream",
  [ApiErrorCode.DRAFT_ANCHOR_ORPHANED]: "upstream",
  [ApiErrorCode.DRAFT_LIMIT_REACHED]: "upstream",
  [ApiErrorCode.PR_CHANGED_SINCE_READ]: "upstream",
  [ApiErrorCode.PR_REWRITTEN_SINCE_READ]: "upstream",
  [ApiErrorCode.APP_NOT_INSTALLED]: "upstream",
  [ApiErrorCode.GITHUB_UNAVAILABLE]: "upstream",
  [ApiErrorCode.GENERATION_FAILED]: "upstream",
  [ApiErrorCode.GENERATION_UNAVAILABLE]: "upstream",
  [ApiErrorCode.GENERATION_CONFIG]: "upstream",
  [ApiErrorCode.INTERNAL_ERROR]: "upstream",
  // Web-local; never on the wire — errorFromResponse cannot produce it.
  [ApiErrorCode.MALFORMED]: "upstream",
} as const satisfies Record<ApiErrorCode, ReplyFailureKind>;

function isPostedBody(value: unknown): value is { commentId: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "commentId" in value &&
    typeof value.commentId === "number" &&
    Number.isSafeInteger(value.commentId)
  );
}

export async function postConversationReply(
  repoId: string,
  prNumber: number,
  rootCommentId: number,
  body: string,
): Promise<ReplyResult> {
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/comments/${String(rootCommentId)}/replies`;
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    const { code } = await errorFromResponse(response, path);
    return { kind: KIND_FOR_CODE[code] };
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
  return { kind: "posted", commentId: parsed.commentId };
}
