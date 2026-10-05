// Builds the migrated-PGlite snapshot once, before any worker starts, so no
// test pays for it. Without this the first test in each file races to run the
// migrations on a cold cache: seconds under v8 coverage, enough to force a
// raised `testTimeout`.
import { warmPgliteSnapshot } from "../src/testing/pglite-snapshot";

export async function setup(): Promise<void> {
  await warmPgliteSnapshot();
}
