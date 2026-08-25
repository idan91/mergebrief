// Identities of the GENERATED perf fixture set (`pnpm perf:fixture`).
// Mirrors `../fixtures/ids.ts`: the generator writes these names in the
// ingest tool's filename grammar (`<stem>_<index>_<head8>`) and the perf
// specs navigate to the seeded rows.
export const PERF_FIXTURE_STEM = "mergebrief-perf-fixture-1";

export const PERF_SHA_REV1 = "aaaaaaaa1111bbbb2222cccc3333dddd4444eeee";
export const PERF_SHA_REV2 = "bbbbbbbb5555cccc6666dddd7777eeee8888ffff";
export const PERF_SHA_BASE = "0000000011112222333344445555666677778888";

const head8 = (sha: string): string => sha.slice(0, 8);

export const PERF_FIXTURE_REV1_ID = `${PERF_FIXTURE_STEM}_1_${head8(PERF_SHA_REV1)}`;
export const PERF_FIXTURE_REV2_ID = `${PERF_FIXTURE_STEM}_2_${head8(PERF_SHA_REV2)}`;

export const PERF_COMPARISON_ID = `${PERF_FIXTURE_STEM}_previous-brief_${head8(PERF_SHA_REV1)}-${head8(PERF_SHA_REV2)}`;

/** The perf suite's seeded route identities (repo id set by the harness). */
export const PERF_PR_PATH = "/repos/424243/pulls/1";
export const PERF_ROUTE_REV1 = `${PERF_PR_PATH}?base=${PERF_SHA_BASE}&head=${PERF_SHA_REV1}`;
export const PERF_ROUTE_REV2 = `${PERF_PR_PATH}?base=${PERF_SHA_BASE}&head=${PERF_SHA_REV2}`;
