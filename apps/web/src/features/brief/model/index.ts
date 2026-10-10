// Route `validateSearch` imports this entry and is never code-split, so it
// ships in the client entry chunk: its graph stays free of the Brief screen.
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
export { briefErrorDetail, prBriefErrorDetail } from "./utils/briefErrors";
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
