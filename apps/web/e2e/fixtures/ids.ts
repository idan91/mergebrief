// Identities of the committed fixture set in `./briefs`, as the seeded
// database serves them: real categorizer output re-identified onto a
// fictional repo, so nothing here reads as live data.

export const FIXTURE_PR_PATH = "/repos/424242/pulls/1";

export const FIXTURE_BASE_SHA = "0000000099998888777766665555444433332222";

export const FIXTURE_REV1_HEAD = "11111111aaaa2222bbbb3333cccc4444dddd5555";
export const FIXTURE_REV2_HEAD = "22222222eeee3333ffff4444aaaa5555bbbb6666";

/** Revision 1 has no baseline, so Compare offers nothing. */
export const FIXTURE_ROUTE_REV1 = `${FIXTURE_PR_PATH}?rev=1`;

/** Revision 2 carries previous-brief marks plus a revision narrative. */
export const FIXTURE_ROUTE_REV2 = `${FIXTURE_PR_PATH}?rev=2`;

/** Revision 1 the way an Entry comment posted before `rev` addressed it. */
export const FIXTURE_ROUTE_REV1_LEGACY_SPAN = `${FIXTURE_PR_PATH}?base=${FIXTURE_BASE_SHA}&head=${FIXTURE_REV1_HEAD}`;

export const FIXTURE_PR_TITLE =
  "feat: front-door accessibility and keyboard navigation";

/** Change-group headings, in the fixture's reading order. */
export const FIXTURE_GROUP_TITLES = [
  "Front-door accessibility and brand metadata fixes",
  "Index risk flags and rework addressFlags/perf helpers",
] as const;

/** No row was seeded for this pull request. */
export const MISSING_PR_PATH = "/repos/424242/pulls/999";

/** Outdated review threads the GitHub stub serves on the fixture PR. */
export const FIXTURE_BRIEFED_ANCHOR_THREAD_ID = 880001;
export const FIXTURE_UNBRIEFED_ANCHOR_THREAD_ID = 880002;
export const FIXTURE_UNBRIEFED_SHA = "99999999ffff8888eeee7777dddd6666cccc5555";
