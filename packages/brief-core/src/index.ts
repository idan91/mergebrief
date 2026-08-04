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
// Closed risk-surface vocabulary — the single source of truth (types.ts).
// Re-exported so downstream packages (repo-config, ADR 0032) import the
// built-in attribute list from here instead of duplicating it.
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
export { generateAndWrite, type Range } from "./cli/categorize";
export {
  Categories,
  Concerns,
  Roles,
  RiskSurfaceAttributes,
  Specificities,
  RevisionNarrativeSkipReasons,
  PrLifecycleStates,
  briefGenerationSchemaWith,
  toPrLifecycleState,
  type Brief,
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
