import { ArtifactIssueCodes } from "brief-core/artifact";

export const PAGE_SIZE = 100;

/** The read repairs the strict reader stops making once every row is rewritten. */
export const LEGACY_ISSUE_CODES: ReadonlySet<string> = new Set([
  ArtifactIssueCodes.LEGACY_MEMBERSHIP,
  ArtifactIssueCodes.MINTED_GROUP_ID,
]);

export const BRIEF_FILE_SUFFIX = ".brief.json";

/** Fixed table names, never input: the only text interpolated into SQL. */
export const DeletableTables = {
  DELTA: "delta",
  REVISION_NARRATIVE: "revision_narrative",
} as const;

export const FILE_INDENT = 2;
