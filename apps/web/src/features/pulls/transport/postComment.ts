// Every failure is a result kind for own-draft toast copy.
// Keep body limits in lockstep with the route. The composer blocks empty bodies,
// postCommentBlockedReason blocks long ones, and anchors encode only true multiline ranges.
// Any remaining deterministic 400 requires editing the draft, never retrying unchanged.
import { ProductActionIds, type CreateInlineCommentBody } from "contract";

import {
  PostCommentResultKinds,
  type PostCommentResult,
  type PostCommentResultKind,
} from "@web/features/brief/model";

import { ApiErrorCodes } from "../../../data/apiFetch";
import { postedCommentSchema } from "../../../data/postedComment";
import { readFailureKind, request } from "../../../data/request";
import type { WriteKindTable } from "../../../data/request/types";

type PostCommentFailureKind = Exclude<
  PostCommentResultKind,
  typeof PostCommentResultKinds.POSTED
>;

// Frozen-session and rewritten-PR failures require reloading to re-anchor.
// Orphaned/published drafts are neither stale nor retryable; 413 requires a
// body edit. A malformed 2xx means the comment may have posted.
const PostKinds: WriteKindTable<PostCommentFailureKind> = {
  [ApiErrorCodes.GITHUB_PERMISSION]: PostCommentResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: PostCommentResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.NOT_FOUND]: PostCommentResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: PostCommentResultKinds.INVALID,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: PostCommentResultKinds.INVALID,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: PostCommentResultKinds.INVALID,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]:
    PostCommentResultKinds.ALREADY_PUBLISHED,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: PostCommentResultKinds.ORPHANED_ANCHOR,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: PostCommentResultKinds.PUBLISH_PENDING,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]:
    PostCommentResultKinds.PUBLISH_IN_DOUBT,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: PostCommentResultKinds.STALE,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: PostCommentResultKinds.STALE,
  [ApiErrorCodes.MALFORMED]: PostCommentResultKinds.INDETERMINATE,
  fallback: PostCommentResultKinds.UPSTREAM,
};

/**
 * The route posts a draft the SESSION holds: the anchor and body are already
 * stored, and the commit comes off the named Brief's head. All this carries
 * is which draft.
 */
export async function postInlineComment(
  repoId: string,
  prNumber: number,
  span: { base: string; head: string },
  body: CreateInlineCommentBody,
): Promise<PostCommentResult> {
  try {
    return await request(
      ProductActionIds.CREATE_INLINE_COMMENT,
      {
        params: { repoId, prNumber },
        query: { base: span.base, head: span.head },
        body,
      },
      postedCommentSchema,
    );
  } catch (error) {
    return { kind: readFailureKind(error, PostKinds) };
  }
}
