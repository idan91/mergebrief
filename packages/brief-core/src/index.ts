/**
 * Public reuse surface of the categorizer engine, the package entry point
 * for other front doors (currently: the web app's server fn) that need the
 * same fetch→categorize→write pipeline the CLI runs, without shelling out to
 * the CLI itself.
 */
export {
  parsePrUrl,
  fetchPr,
  fetchPrMetadata,
  ghPrSource,
  MAX_COMMENTS,
  normalizeReviewComment,
  type PrLocator,
  type PrFile,
  type PrMetadata,
  type PrSource,
  type FetchedPr,
} from "./github";
export {
  buildContextQuery,
  collectTicketReferences,
  ContextProviderTypes,
  createBuiltInContextProviders,
  createGitHubRead,
  createNotionRead,
  GitHubTransports,
  NotionTransports,
  checkConfiguredTrackerReads,
  listReadableTrackers,
  resolveTrackerReads,
  type PrimaryRead,
  type SharedRootDeps,
  type TrackerReads,
  type TrackerRootDeps,
  fetchContextSnippets,
  MAX_SNIPPET_CHARS,
  readFailureForStatus,
  type IssueLocator,
  type GitHubTransport,
  type InstallationIssueApi,
  type NotionTransport,
  type IssueRecord,
  resolvePrimaryTicket,
  type TicketReference,
  type TicketReferenceInput,
  type ContextProvider,
  type ContextProviderDeps,
  type ContextProviderType,
  type ContextQuery,
  type ContextFetch,
  type ContextReadFailure,
  type ContextSnippet,
  type PrimarySnippet,
  type PrimaryTicketOutcome,
  type ProviderSnippet,
  toPrimaryTicket,
} from "./context";
export {
  categorizeDelta,
  categorizeRevisionNarrative,
  type DeltaInput,
  type RevisionNarrativeInput,
} from "./generation/categorize";
export { splitDiffByFile } from "./diff/file-diff";
export {
  assignBriefIndex,
  lookupBriefIndex,
  lookupBriefShaByIndex,
} from "./artifacts/manifest";
export {
  prStem,
  briefId,
  outName,
  diffsName,
  commentsName,
  revChangesName,
  revisionNarrativeName,
} from "./artifacts/output";
export {
  buildRevisionChanges,
  parseChangedRanges,
  changedRangesFromFileDiffs,
  countChangedLines,
  type RevisionChanges,
  type RevisionChangeFile,
} from "./diff/revchanges";
export {
  buildComparisonMarks,
  comparisonMarksName,
  writeComparisonMarks,
  type ComparisonMarks,
  type ComparisonBaselineLabel,
} from "./diff/comparison";
export {
  GroupVerdicts,
  partitionGroups,
  type CompareFileEntry,
  type GroupPartition,
  type GroupVerdict,
  type PartitionInput,
  type PreviousGroupFiles,
} from "./diff/touched";
export {
  parseHunkSpans,
  remapRanges,
  remapThroughHops,
  remapThroughPatch,
  RemapOutcomes,
  type FileHunkSpans,
  type Hop,
  type HunkSpan,
  type RemapOutcome,
  type RemapResult,
} from "./diff/remap";
export {
  assignGroupIds,
  type AssignGroupIdsArgs,
  type DescentGroup,
} from "./diff/descent";
export {
  DEFAULT_HUGE_SPAN_RATIO,
  isHugeSpan,
  parseHugeSpanRatio,
} from "./generation/huge-span";
export {
  CUSTOM_ATTRIBUTE_NAME_PATTERN,
  INSTRUCTIONS_INJECTION_BUDGET_BYTES,
  PARKED_ATTRIBUTE_CANDIDATES,
  REPO_INSTRUCTION_CLASSES,
  RESERVED_ATTRIBUTE_WORDS,
  inAttributeScope,
  type CustomRiskAttributeInput,
  type RepoContext,
  type RepoInstructionsInput,
} from "./generation/repo-context";
export { matchesGlob } from "./path-matching";
export {
  parseRevisionNarrativeFlag,
  type RevisionNarrativeConfig,
} from "./generation/config";
// Pure warn-issue validators the worker re-runs on a merged artifact.
export {
  TEXT_LENGTH_CAPS,
  validatePartition,
  validateTextLength,
  validateReadingOrder,
} from "./generation/validate";
// Mechanical LoC derivation: the model attributes ranges, code counts.
export {
  buildConcernView,
  countLines,
  crossCheckFileTotals,
  deriveChunkLoc,
  deriveUnattributed,
  detectChunkOverlaps,
  diffLocTotals,
  intersectRanges,
  subtractRanges,
  unattributedTotals,
  type LocCount,
} from "./generation/loc";
// The worker builds AnchorViewInput from its plan; renderAnchorView is
// exported for tests/CLI.
export { renderAnchorView, type AnchorViewInput } from "./generation/prompt";
export {
  attachPrStack,
  isLinearPrStack,
  isSamePrStack,
  mergeStackHistory,
  resolvePrStack,
  PrStackSchema,
  type ForkPrStack,
  type LinearPrStack,
  type OpenPullRequest,
  type RepoIdentity,
  type PrStack,
  type PrStackMember,
  type PrStackSelf,
  type StoredPrStack,
} from "./pr-stack";
export { generateAndWrite, type Range } from "./cli/categorize";
export { generateBrief } from "./generation/brief";
export type {
  GenerateBriefOptions,
  GenerateBriefOutput,
  PreviousBriefInput,
} from "./generation/brief/types";
export { planAnchoredGeneration } from "./anchoring";
export type {
  AnchorPlan,
  AnchorPlanArgs,
  CompareFile,
  CompareFiles,
  FrozenCarry,
  ReLookEntry,
  StitchArgs,
  StitchResult,
} from "./anchoring/types";
export {
  Categories,
  Concerns,
  TextSurfaces,
  type LengthViolation,
  type TextSurface,
  Roles,
  RiskSurfaceAttributes,
  Specificities,
  RevisionNarrativeSkipReasons,
  PrLifecycleStates,
  AlignmentReads,
  PrimaryTicketStatuses,
  ReferenceLocations,
  TicketUnreadReasons,
  briefGenerationSchemaWith,
  toPrLifecycleState,
  type Brief,
  type Category,
  type Concern,
  type Role,
  type Specificity,
  type RevisionNarrativeSkipReason,
  type CommitRange,
  type IntentBucket,
  type IntentCheck,
  type IntentCheckGeneration,
  type IntentItem,
  type PrLifecycleState,
  type PrimaryTicket,
  type PrimaryTicketStatus,
  type ReferenceLocation,
  type TicketUnreadReason,
  type RiskSurfaceAttribute,
  type RevisionNarrative,
  type RevisionNarrativeChunk,
  type RevisionNarrativeSkipped,
  type ReviewComment,
  type UnattributedFile,
} from "./types";
