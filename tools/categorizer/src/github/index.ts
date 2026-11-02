/**
 * Folder barrel for the gh-CLI PR-fetch surface. Folder-internal plumbing
 * (repoSlug) deliberately stays off it.
 */
export type { GhOpenPullRequestParseError } from "./fetch";
export {
  fetchCommitDate,
  fetchCompareCommitCount,
  fetchCompareDiff,
  fetchPrDiff,
  fetchPrMetadata,
  isCommitish,
  metadataFromView,
  OPEN_PR_LIST_LIMIT,
  parseGhOpenPullRequests,
  resolveFullSha,
} from "./fetch";
export {
  fetchReviewComments,
  fetchReviewCommentsCreatedBy,
  isCommentOutdated,
  MAX_COMMENTS,
  normalizeReviewComment,
} from "./comments";
export { ghPrSource, type PrSource } from "./source";
export { buildGhPrSpanSource } from "./span-source";
