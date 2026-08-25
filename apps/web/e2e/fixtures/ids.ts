// Identities of the committed fixture artifact set in `./briefs`, as the
// SEEDED DATABASE serves them (the global setup ingests these files under
// the owner world). The files were derived from real categorizer output,
// trimmed to two change groups over three files and re-identified onto a
// fictional repo so nothing here reads as live data.
//
// The suite drives the repo route — `/repos/:repoId/pulls/:prNumber` with a
// `base`/`head` span — exactly as a real signed-in viewer reaches a brief.

/** The seeded pull request's route root. */
export const FIXTURE_PR_PATH = "/repos/424242/pulls/1";

/** The whole-PR span base both revisions share. */
export const FIXTURE_BASE_SHA = "0000000099998888777766665555444433332222";

/** Revision heads (the brief files' commitRange.head values). */
export const FIXTURE_REV1_HEAD = "11111111aaaa2222bbbb3333cccc4444dddd5555";
export const FIXTURE_REV2_HEAD = "22222222eeee3333ffff4444aaaa5555bbbb6666";

/** Revision 1: a brief with no baseline, so Compare offers nothing. */
export const FIXTURE_ROUTE_REV1 = `${FIXTURE_PR_PATH}?base=${FIXTURE_BASE_SHA}&head=${FIXTURE_REV1_HEAD}`;

/** Revision 2: carries previous-brief marks plus a revision narrative. */
export const FIXTURE_ROUTE_REV2 = `${FIXTURE_PR_PATH}?base=${FIXTURE_BASE_SHA}&head=${FIXTURE_REV2_HEAD}`;

/** The PR title both revisions render as the page `<h1>`. */
export const FIXTURE_PR_TITLE =
  "feat: front-door accessibility and keyboard navigation";

/** Change-group headings, in the fixture's reading order. */
export const FIXTURE_GROUP_TITLES = [
  "Front-door accessibility and brand metadata fixes",
  "Index risk flags and rework addressFlags/perf helpers",
] as const;

/** A pull request no row was seeded for — the route's not-found state. */
export const MISSING_PR_PATH = "/repos/424242/pulls/999";
