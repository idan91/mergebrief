/**
 * Public reuse surface of the categorizer engine — the package entry point
 * for other front doors (currently: the web app's server fn) that need the
 * same fetch→categorize→write pipeline the CLI runs, without shelling out to
 * the CLI itself.
 */
export {
  parsePrUrl,
  fetchPr,
  fetchPrMetadata,
  fetchLinkedContext,
  ghPrSource,
  MAX_COMMENTS,
  normalizeReviewComment,
  type PrLocator,
  type PrFile,
  type PrMetadata,
  type PrSource,
  type FetchedPr,
  type LinkedContext,
  type ReviewComment,
} from "./github";
export {
  categorize,
  categorizeDelta,
  categorizeRevisionNarrative,
  type DeltaInput,
  type RevisionNarrativeInput,
} from "./generation/categorize";
export { splitDiffByFile } from "./diff/diff";
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
  comparisonMarksName,
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
  writeComparisonMarks,
  type ComparisonMarks,
  type ComparisonMarksFile,
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
  remapThroughPatch,
  RemapOutcomes,
  type HunkSpan,
  type RemapOutcome,
  type RemapResult,
} from "./diff/remap";
export {
  assignGroupIds,
  type AssignGroupIdsArgs,
  type DescentGroup,
} from "./diff/descent";
export { isHugeSpan, hugeSpanRatio } from "./generation/huge-span";
export {
  CUSTOM_ATTRIBUTE_NAME_PATTERN,
  INSTRUCTIONS_INJECTION_BUDGET_BYTES,
  PARKED_ATTRIBUTE_CANDIDATES,
  REPO_INSTRUCTION_CLASSES,
  RESERVED_ATTRIBUTE_WORDS,
  inAttributeScope,
  matchesGlob,
  type CustomRiskAttributeInput,
  type RepoContext,
  type RepoInstructionsInput,
} from "./generation/repo-context";
export {
  revisionNarrativeConfig,
  type RevisionNarrativeConfig,
} from "./generation/config";
// Pure warn-issue validators the worker re-runs on a merged artifact.
export {
  TEXT_LENGTH_CAPS,
  validatePartition,
  validateTextLength,
  validateReadingOrder,
} from "./generation/validate";
// The worker builds AnchorViewInput from its plan; renderAnchorView is
// exported for tests/CLI.
export { renderAnchorView, type AnchorViewInput } from "./generation/prompt";
export { generateAndWrite, type Range } from "./cli/categorize";
export {
  AnchorStates,
  Categories,
  Concerns,
  FreshRestartReasons,
  TextSurfaces,
  type LengthViolation,
  type TextSurface,
  Roles,
  RiskSurfaceAttributes,
  Specificities,
  RevisionNarrativeSkipReasons,
  PrLifecycleStates,
  briefGenerationSchemaWith,
  toPrLifecycleState,
  type Anchor,
  type AnchorState,
  type Brief,
  type FreshRestartReason,
  type Category,
  type Concern,
  type Role,
  type Specificity,
  type RevisionNarrativeSkipReason,
  type CommitRange,
  type Effort,
  type IntentBucket,
  type IntentCheck,
  type IntentCheckGeneration,
  type IntentItem,
  type PrLifecycleState,
  type RiskSurfaceAttribute,
  type RevisionNarrative,
  type RevisionNarrativeChunk,
  type RevisionNarrativeSkipped,
} from "./types";
