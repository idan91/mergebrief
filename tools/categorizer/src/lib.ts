/**
 * Public reuse surface of the categorizer engine — the package entry point
 * for other front doors (currently: the web app's server fn) that need the
 * same fetch→categorize→write pipeline the CLI runs, without shelling out to
 * the CLI itself.
 */
export { parsePrUrl, fetchPr, fetchPrMetadata, type PrLocator } from "./github.js";
export { categorize } from "./categorize.js";
export { AnthropicGenerator, type Generator } from "./generator.js";
export { splitDiffByFile } from "./diff.js";
export { assignBriefIndex, lookupBriefIndex } from "./manifest.js";
export { prStem, briefId, outName, diffsName, commentsName } from "./output.js";
export { generateAndWrite, type Range } from "./index.js";
export type { Brief, CommitRange } from "./types.js";
