// Route `validateSearch` imports this entry and is never code-split, so it
// ships in the client entry chunk: its graph stays free of the Brief screen.
export {
  buildBriefSearchParams,
  compareUnavailableTitle,
  isCompareAvailable,
  lastReviewUnavailableReasonTitle,
  previousBriefUnavailableReasonTitle,
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
} from "./comparison/compare-state";
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
  type PrStackMember,
  type PullStack,
  type RevisionPoint,
  type RevisionTimelineView,
} from "./types";
export { briefErrorDetail, prBriefErrorDetail } from "./utils/brief-errors";
export { createFileRowsCache } from "./file-rows/cache";
export { countBriefFiles } from "./utils/brief-files";
export {
  buildChunkLayoutCounts,
  type ChunkLayoutState,
} from "./chunk-layout/useChunkLayout";
export { resolveLegacyDeltaRedirect } from "./utils/legacy-redirect";
export {
  GroupViewKinds,
  isUnattributedRemainderChunk,
} from "./utils/remainder";
export type { RepoConfigContext } from "./utils/repo-config";
export { buildRevisionTimeline } from "./utils/revision-timeline";
export {
  briefContextSchema,
  parseComparisonMarks,
  parseFileDiffPatches,
} from "./schemas";
export {
  parseBrief,
  parseDeltaBrief,
  parseRevisionNarrativeArtifact,
} from "./utils/validation";
export {
  buildBriefViewModel,
  getRiskAttributeLabel,
  type BriefViewModel,
  type RiskFlag,
} from "./utils/view-model";
