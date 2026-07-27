// Flat at the feature root with reason (ADR 0037 SS4): the feature's one
// write transport - a single file earns no category folder.
// Reply transport (BRIEF-25, locked decision 7): replies post IMMEDIATELY
// with the viewer's token — GitHub's create-review comments[] has no
// in_reply_to, so there is no batched alternative. Expected failure
// statuses are RESULT KINDS the composer renders; only a malformed 2xx
// throws (contract violation). Mirrors the submit transport's posture.
import { ApiError, ApiErrorKind, apiFetch } from "../../data/apiFetch";

export type ReplyResult =
  | { readonly kind: "posted"; readonly commentId: number }
  /** 401 — session expired; sign in again. Draft stays. */
  | { readonly kind: "unauthorized" }
  /** 404 — the thread's root comment (or the PR) is gone. */
  | { readonly kind: "not-found" }
  /** 400 — the route rejected the shape (mirrored client-side; programmer error). */
  | { readonly kind: "invalid" }
  /** 502/anything else — GitHub rejected or is unreachable. */
  | { readonly kind: "upstream" };

/** Mirror of the route's Zod cap — a deterministic 400 must block client-side. */
export const MAX_REPLY_LENGTH = 65_536;

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
  if (response.status === 401) return { kind: "unauthorized" };
  if (response.status === 404) return { kind: "not-found" };
  if (response.status === 400) return { kind: "invalid" };
  if (!response.ok) return { kind: "upstream" };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(ApiErrorKind.MALFORMED, response.status, path);
  }
  if (!isPostedBody(parsed)) {
    throw new ApiError(ApiErrorKind.MALFORMED, response.status, path);
  }
  return { kind: "posted", commentId: parsed.commentId };
}
