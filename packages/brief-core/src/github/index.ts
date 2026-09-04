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
export {
  fetchCompareCommitCount,
  fetchCompareDiff,
  fetchPr,
  fetchPrDiff,
  fetchPrMetadata,
  isCommitish,
  metadataFromView,
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
