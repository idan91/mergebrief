import type { ValueOf } from "types/utils";
import type { PostedComment } from "../../../data/postedComment";

export const PostCommentResultKinds = {
  POSTED: "posted",
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "not-found",
  STALE: "stale",
  ORPHANED_ANCHOR: "orphaned-anchor",
  ALREADY_PUBLISHED: "already-published",
  PUBLISH_PENDING: "publish-pending",
  PUBLISH_IN_DOUBT: "publish-in-doubt",
  INVALID: "invalid",
  NO_WRITE_ACCESS: "no-write-access",
  UPSTREAM: "upstream",
} as const;
export type PostCommentResultKind = ValueOf<typeof PostCommentResultKinds>;

export type PostCommentResult =
  | PostedComment
  /** 401, session expired; sign in again. The draft stays. */
  | { readonly kind: typeof PostCommentResultKinds.UNAUTHORIZED }
  /** 404, the PR (or repo access) is gone. */
  | { readonly kind: typeof PostCommentResultKinds.NOT_FOUND }
  /** 409, the head advanced under the pinned commit; reload to re-anchor. */
  | { readonly kind: typeof PostCommentResultKinds.STALE }
  /** 409, the draft's anchor points at no code; re-place or delete it. */
  | { readonly kind: typeof PostCommentResultKinds.ORPHANED_ANCHOR }
  /** 409, the draft is already on GitHub; nothing posted twice. */
  | { readonly kind: typeof PostCommentResultKinds.ALREADY_PUBLISHED }
  /** 409, an earlier attempt on this draft is still running. */
  | { readonly kind: typeof PostCommentResultKinds.PUBLISH_PENDING }
  /** 409, an earlier attempt may have posted it and GitHub could not say. */
  | { readonly kind: typeof PostCommentResultKinds.PUBLISH_IN_DOUBT }
  /** 400 (shape; mirrored client-side) or deterministic 413, edit the body, retry-as-is never clears. */
  | { readonly kind: typeof PostCommentResultKinds.INVALID }
  /**
   * 403, a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { readonly kind: typeof PostCommentResultKinds.NO_WRITE_ACCESS }
  /** 502/anything else, GitHub rejected or is unreachable. */
  | { readonly kind: typeof PostCommentResultKinds.UPSTREAM };

export const MarkReadyResultKinds = {
  READY: "ready",
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "not-found",
  GITHUB_PERMISSION: "github-permission",
  NO_WRITE_ACCESS: "no-write-access",
  UPSTREAM: "upstream",
} as const;
export type MarkReadyResultKind = ValueOf<typeof MarkReadyResultKinds>;

export type MarkReadyResult =
  /** The PR is ready: fresh flip or already-ready convergence (indistinguishable). */
  | { kind: typeof MarkReadyResultKinds.READY }
  | { kind: typeof MarkReadyResultKinds.UNAUTHORIZED }
  | { kind: typeof MarkReadyResultKinds.NOT_FOUND }
  /**
   * 403: the App lacks `contents: write`. A distinct kind so the FE gives
   * actionable copy instead of the "no longer accessible" 404 copy: the viewer
   * proved repo access, so this is not an existence miss.
   */
  | { kind: typeof MarkReadyResultKinds.GITHUB_PERMISSION }
  /**
   * 403: a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { kind: typeof MarkReadyResultKinds.NO_WRITE_ACCESS }
  | { kind: typeof MarkReadyResultKinds.UPSTREAM };
