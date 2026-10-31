export { parsePrUrl, type PrLocator } from "./github/pr-url";
export type { FetchedPr, PrMetadata } from "./github/types";
export {
  buildContextQuery,
  ContextProviderTypes,
  createBuiltInContextProviders,
  GitHubTransports,
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
  type DeltaInput,
} from "./generation/categorize";
export { splitDiffByFile } from "./diff/file-diff";
export {
  parseChangedRanges,
  countChangedLines,
  type RevisionChanges,
  type RevisionChangeFile,
} from "./diff/revchanges";
export { buildComparisonMarks, writeComparisonMarks } from "./diff/comparison";
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
export { TEXT_LENGTH_CAPS } from "./generation/validate";
export {
  attachPrStack,
  isSamePrStack,
  mergeStackHistory,
  PrStackSchema,
  type OpenPullRequest,
} from "./pr-stack";
export { generateBrief } from "./generation/brief";
export { decideCallPlan, predictCallPlan } from "./generation/size";
export type { MultiCallHooks, PartKey } from "./generation/multi-call/types";
export { CallPlanKinds } from "./generation/size/types";
export { countPullRequestSecrets } from "./generation/redaction";
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
export type { AnchorPlan, CompareFile, CompareFiles } from "./anchoring/types";
export {
  CUSTOM_ATTRIBUTE_NAME_PATTERN,
  TextSurfaces,
  TicketUnreadReasons,
  toPrLifecycleState,
  type Brief,
  type RevisionNarrativeSkipped,
} from "./types";
