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
  type PrLocator,
  type PrFile,
  type PrMetadata,
  type FetchedPr,
  type LinkedContext,
} from "./github";
export {
  categorize,
  categorizeDelta,
  categorizeRevisionNarrative,
  type DeltaInput,
  type RevisionNarrativeInput,
} from "./categorize";
export { splitDiffByFile } from "./diff";
export { assignBriefIndex, lookupBriefIndex, lookupBriefShaByIndex } from "./manifest";
export {
  prStem,
  briefId,
  outName,
  diffsName,
  commentsName,
  revChangesName,
  comparisonMarksName,
  revisionNarrativeName,
} from "./output";
export {
  buildRevisionChanges,
  parseChangedRanges,
  changedRangesFromFileDiffs,
  countChangedLines,
  type RevisionChanges,
  type RevisionChangeFile,
} from "./revchanges";
export {
  buildComparisonMarks,
  writeComparisonMarks,
  type ComparisonMarks,
  type ComparisonMarksFile,
  type ComparisonBaselineLabel,
} from "./comparison";
// Closed risk-surface vocabulary — the single source of truth (types.ts).
// Re-exported so downstream packages (repo-config, ADR 0032) import the
// built-in attribute list from here instead of duplicating it.
export { isHugeSpan, hugeSpanRatio } from "./huge-span";
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
} from "./repo-context";
export { revisionNarrativeConfig, type RevisionNarrativeConfig } from "./config";
export { generateAndWrite, type Range } from "./index";
export {
  RiskSurfaceAttributes,
  briefGenerationSchemaWith,
  type Brief,
  type CommitRange,
  type Effort,
  type RiskSurfaceAttribute,
  type RevisionNarrative,
  type RevisionNarrativeChunk,
  type RevisionNarrativeSkipped,
} from "./types";
