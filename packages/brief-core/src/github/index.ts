/**
 * Folder barrel for the gh-CLI PR-fetch surface. Folder-internal plumbing
 * (execFileAsync, MAX_BUFFER, repoSlug) deliberately stays off it.
 */
export type { FetchedPr, PrFile, PrMetadata } from "./types";
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
  resolveFullSha,
} from "./fetch";
export { parsePrUrl, type PrLocator } from "./pr-url";
export {
  fetchReviewComments,
  isCommentOutdated,
  MAX_COMMENTS,
  normalizeReviewComment,
} from "./comments";
export { ghPrSource, type PrSource } from "./source";
