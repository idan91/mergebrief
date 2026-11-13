export { parsePrUrl, type PrLocator } from "./github/pr-url";
export type { FetchedPr, PrMetadata } from "./github/types";
export {
  buildContextQuery,
  ContextProviderTypes,
  createBuiltInContextProviders,
  GitHubTransports,
  JiraTransports,
  NotionTransports,
  checkConfiguredTrackerReads,
  listReadableTrackers,
  resolveTrackerReads,
  type SharedRootDeps,
  type TrackerReads,
  type TrackerRootDeps,
  fetchContextSnippets,
  type FetchContextSnippetsOptions,
  type InstallationIssueApi,
  type ContextProvider,
  type ContextQuery,
  type ContextFetch,
  type ContextReadFailure,
  type ContextSnippet,
  type PrimarySnippet,
  type PrimaryTicketOutcome,
  toPrimaryTicket,
} from "./context";
export {
  categorizeDelta,
  categorizeRevisionNarrative,
  exceedsDeltaCallLimits,
  exceedsNarrativeCallLimits,
  shapeDeltaSkipped,
  shapeDeltaUnchanged,
  type DeltaInput,
  type DeltaSpanRef,
  type RevisionNarrativeInput,
} from "./generation/categorize";
export { restoreRawPaths } from "./generation/untrusted-text";
export { splitDiffByFile } from "./diff/file-diff";
export {
  parseChangedRanges,
  countChangedLines,
  type RevisionChanges,
  type RevisionChangeFile,
} from "./diff/revchanges";
export {
  buildComparisonMarks,
  writeComparisonMarks,
  type ComparisonMarks,
} from "./diff/comparison";
export { isHugeSpan, parseHugeSpanRatio } from "./generation/huge-span";
export {
  INSTRUCTIONS_INJECTION_BUDGET_BYTES,
  PARKED_ATTRIBUTE_CANDIDATES,
  RESERVED_ATTRIBUTE_WORDS,
  type CustomRiskAttributeInput,
  type RepoContext,
} from "./generation/repo-context";
export {
  parseRevisionNarrativeFlag,
  type RevisionNarrativeConfig,
} from "./generation/config";
export {
  TEXT_LENGTH_CAPS,
  validateMarksNarrativeCoverage,
  validateNarrativeGroups,
  validateNarrativeMarksOverlap,
  validatePartition,
} from "./generation/validate";
export { detectChunkOverlaps } from "./generation/loc";
export {
  attachPrStack,
  isSamePrStack,
  mergeStackHistory,
  PrStackSchema,
  type OpenPullRequest,
} from "./pr-stack";
export { generateBrief } from "./generation/brief";
export { readInputFingerprint } from "./generation/input-fingerprint";
export { decideCallPlan, predictCallPlan } from "./generation/size";
export { SINGLE_CALL_MAX_HUNKS } from "./generation/size/consts";
export { DEFAULT_DETAIL_CONCURRENCY } from "./generation/multi-call/consts";
export type { MultiCallHooks, PartKey } from "./generation/multi-call/types";
export { CallPlanKinds } from "./generation/size/types";
export { countPullRequestSecrets } from "./generation/redaction";
export { dropNoTestsOnExemptFiles } from "./generation/no-tests-exempt-files";
export {
  listChangedLockfiles,
  type ChangedLockfile,
} from "./generation/package-sources";
export { DiffFileStatuses } from "./diff/hunk-index/types";
export type {
  GenerateBriefOptions,
  PreviousBriefInput,
} from "./generation/brief/types";
export { planAnchoredGeneration } from "./anchoring";
export type { AnchorPlan } from "./anchoring/types";
export {
  CUSTOM_ATTRIBUTE_NAME_PATTERN,
  DeltaSkipReasons,
  TextSurfaces,
  TicketUnreadReasons,
  toPrLifecycleState,
  type Brief,
  type RevisionNarrativeSkipped,
} from "./types";
