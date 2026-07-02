/**
 * Public reuse surface of the categorizer engine — the package entry point
 * for other front doors (currently: the web app's server fn) that need the
 * same fetch→categorize→write pipeline the CLI runs, without shelling out to
 * the CLI itself.
 */
export { parsePrUrl, fetchPr, fetchPrMetadata, type PrLocator } from "./github.js";
export { categorize, categorizeRevisionNarrative } from "./categorize.js";
export { AnthropicGenerator, type Generator } from "./generator.js";
export { splitDiffByFile } from "./diff.js";
export { assignBriefIndex, lookupBriefIndex, lookupBriefShaByIndex } from "./manifest.js";
export {
  prStem,
  briefId,
  outName,
  diffsName,
  commentsName,
  revChangesName,
  comparisonMarksName,
  revisionNarrativeName,
} from "./output.js";
export {
  buildRevisionChanges,
  parseChangedRanges,
  changedRangesFromFileDiffs,
  countChangedLines,
  type RevisionChanges,
  type RevisionChangeFile,
} from "./revchanges.js";
export {
  buildComparisonMarks,
  writeComparisonMarks,
  type ComparisonMarks,
  type ComparisonMarksFile,
  type ComparisonBaselineLabel,
} from "./comparison.js";
export { isHugeSpan, hugeSpanRatio } from "./huge-span.js";
export { revisionNarrativeConfig, type RevisionNarrativeConfig } from "./config.js";
export { generateAndWrite, type Range } from "./index.js";
export type {
  Brief,
  CommitRange,
  RevisionNarrative,
  RevisionNarrativeChunk,
  RevisionNarrativeSkipped,
} from "./types.js";
