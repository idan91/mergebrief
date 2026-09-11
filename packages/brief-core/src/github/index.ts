/**
 * Folder barrel for the gh-CLI PR-fetch surface. Folder-internal plumbing
 * (execFileAsync, MAX_BUFFER, repoSlug) deliberately stays off it.
 */
export type {
  FetchedPr,
  PrFile,
  PrLocator,
  PrMetadata,
  ReviewComment,
} from "./types";
export type { GhOpenPullRequestParseError } from "./fetch";
export {
  fetchCompareCommitCount,
  fetchCompareDiff,
  fetchPr,
  fetchPrDiff,
  fetchPrMetadata,
  isCommitish,
  metadataFromView,
  OPEN_PR_LIST_LIMIT,
  parseGhOpenPullRequests,
  parsePrUrl,
  resolveFullSha,
} from "./fetch";
export {
  fetchReviewComments,
  isCommentOutdated,
  MAX_COMMENTS,
  normalizeReviewComment,
} from "./comments";
export { ghPrSource, type PrSource } from "./source";
