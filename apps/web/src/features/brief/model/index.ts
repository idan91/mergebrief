// Curated model entry for other features and the routes; internal brief files
// import the modules directly. Route `validateSearch` imports it and is never
// code-split, so it ships in the client entry chunk: its graph stays free of
// the Brief screen. Deliberately absent: queries.ts (server-touching modules
// never sit behind a barrel) and fixtures.ts (test-only).
export {
  buildBriefSearchParams,
  compareUnavailableTitle,
  isCompareAvailable,
  lastReviewUnavailableReasonTitle,
  parseBriefAddressSearch,
  resolveBriefSearch,
  stripDefaultSearch,
  withCompare,
  withView,
  type BriefAddressSearch,
  type BriefSearch,
  type BriefSearchParams,
  type CompareOptionFlags,
  type ViewParam,
} from "./comparison/compareState";
export { CompareParams, type CompareParam } from "./comparison/types";
export {
  MarkReadyResultKinds,
  PostCommentResultKinds,
  type AddressedReviewComment,
  type Brief,
  type BriefChunk,
  type ComparisonMarks,
  type ForkPrStack,
  type LinearPrStack,
  type LivePrState,
  type LocalBriefSummary,
  type MarkReadyAction,
  type MarkReadyResult,
  type MarkReadyResultKind,
  type PostCommentResult,
  type PostCommentResultKind,
  type PrStack,
  type PrStackMember,
  type PullStack,
  type RevisionPoint,
  type RevisionTimelineView,
} from "./types";
export { briefErrorDetail } from "./utils/briefErrors";
export {
  attachSlicedDiffs,
  parseUnifiedDiffPatch,
  splitUnifiedDiffByFile,
} from "./utils/diffSlicing";
export { createFileRowsCache } from "./file-rows/cache";
export { resolveLegacyDeltaRedirect } from "./utils/legacyRedirect";
export {
  GroupViewKinds,
  isUnattributedRemainderChunk,
} from "./utils/remainder";
export { parseBriefContext, type RepoConfigContext } from "./utils/repoConfig";
export { buildRevisionTimeline } from "./utils/revision-timeline";
export {
  parseBrief,
  parseComparisonMarks,
  parseDeltaBrief,
  parseRevisionNarrativeArtifact,
} from "./utils/validation";
export {
  buildBriefViewModel,
  type BriefViewModel,
  type RiskFlag,
} from "./utils/viewModel";
