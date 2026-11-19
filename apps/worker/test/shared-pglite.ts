// One migrated PGlite for a whole test file, in place of one per test:
// opened and its baseline recorded before the first test, reset to that
// baseline before each, closed after the last. A test that alters the schema
// takes `openPerTestPglite` instead.
import {
  createPgliteHarness,
  resetPgliteHarness,
  type PgliteHarness,
} from "persistence/testing";
import { afterAll, beforeAll, beforeEach, onTestFinished } from "vitest";

/** The shared instance without `close`: the file's `afterAll` owns that. */
export type SharedPglite = Omit<PgliteHarness, "close">;

/**
 * A test's own instance, closed when the test ends. For a test that alters
 * the schema, which the shared reset could not undo.
 */
export async function openPerTestPglite(): Promise<PgliteHarness> {
  const harness = await createPgliteHarness();
  onTestFinished(() => harness.close());
  return harness;
}

/**
 * Register at module scope or inside the describe whose tests touch the
 * database; the fields resolve only while a test runs.
 */
export function registerSharedPglite(): SharedPglite {
  let harness: PgliteHarness | undefined;
  function requireHarness(): PgliteHarness {
    if (harness === undefined) {
      throw new Error("the shared PGlite is open only while a test runs");
    }
    return harness;
  }

  beforeAll(async () => {
    harness = await createPgliteHarness();
    await resetPgliteHarness(harness);
  });
  beforeEach(async () => {
    await resetPgliteHarness(requireHarness());
  });
  afterAll(async () => {
    await harness?.close();
    harness = undefined;
  });

  return {
    get handle() {
      return requireHarness().handle;
    },
    get database() {
      return requireHarness().database;
    },
    raw(query, params) {
      return requireHarness().raw(query, params);
    },
  };
}
