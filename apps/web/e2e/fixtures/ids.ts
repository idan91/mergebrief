// Identities of the committed fixture artifact set in `./briefs`. The files
// were derived from real categorizer output (schema-valid by construction),
// trimmed to two change groups over three files and re-identified onto a
// fictional repo so nothing here reads as live data.
//
// Layout mirrors the generator's naming — `<stem>_<index>_<head8>` for a
// brief, `<stem>_<label>_<base8>-<head8>.comparison.json` for its marks —
// because `brief.server.ts` derives availability from exactly those names.

/** Revision 1: a brief with no baseline, so Compare offers nothing. */
export const FIXTURE_BRIEF_REV1 = "mergebrief-e2e-fixture-1_1_11111111";

/** Revision 2: carries previous-brief marks plus a revision narrative. */
export const FIXTURE_BRIEF_REV2 = "mergebrief-e2e-fixture-1_2_22222222";

/** The PR title both revisions render as the page `<h1>`. */
export const FIXTURE_PR_TITLE =
  "feat: front-door accessibility and keyboard navigation";

/** Change-group headings, in the fixture's reading order. */
export const FIXTURE_GROUP_TITLES = [
  "Front-door accessibility and brand metadata fixes",
  "Index risk flags and rework addressFlags/perf helpers",
] as const;

/** A brief id matching the id pattern that has no artifacts on disk. */
export const MISSING_BRIEF_ID = "mergebrief-e2e-fixture-1_9_99999999";
