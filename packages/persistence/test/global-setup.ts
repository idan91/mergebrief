// Builds the migrated-PGlite snapshot once, before any worker starts, so no
// test ever pays for it (BRIEF-114). Without this the first test in each of the
// 17 files raced to run the migrations on a cold cache — ~4.5s under v8
// coverage, which is what kept `testTimeout` pinned at 20s. Warming it here is
// what lets this package run on vitest's 5s default.
import { warmPgliteSnapshot } from "../src/pglite-snapshot";

export async function setup(): Promise<void> {
  await warmPgliteSnapshot();
}
