// Builds the migrated-PGlite snapshot before any worker forks (BRIEF-114).
// Without it a cold cache has every worker run the migrations at once under
// coverage instrumentation — the contention that produced the #205 timeouts.
import { warmPgliteSnapshot } from "persistence/testing";

export async function setup(): Promise<void> {
  await warmPgliteSnapshot();
}
