/**
 * Folder barrel (ADR 0037: folder index where it clarifies outside imports) —
 * the gh-CLI PR-fetch surface, split by concern: `fetch.ts` (gh exec + PR/
 * compare fetching), `linked-context.ts` (PR-description link chasing + SSRF
 * guard), `comments.ts` (review-comment fetch + normalization), `types.ts`
 * (wire shapes). Re-exports exactly the pre-split `github.ts` public surface;
 * folder-internal plumbing (execFileAsync, MAX_BUFFER, repoSlug) stays off it.
 */
export type {
  FetchedPr,
  LinkedContext,
  PrFile,
  PrLocator,
  PrMetadata,
  ReviewComment,
} from "./types";
export {
  extractLinks,
  fetchLinkedContext,
  isPublicUrl,
} from "./linked-context";
export {
  fetchCompareCommitCount,
  fetchCompareDiff,
  fetchPr,
  fetchPrDiff,
  fetchPrMetadata,
  isCommitish,
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
