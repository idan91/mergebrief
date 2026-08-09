// Builds the migrated-PGlite snapshot before any worker forks. Without it a
// cold cache has every worker run the migrations at once under coverage
// instrumentation, and the contention times the suite out.
import { warmPgliteSnapshot } from "persistence/testing";

export async function setup(): Promise<void> {
  await warmPgliteSnapshot();
}
