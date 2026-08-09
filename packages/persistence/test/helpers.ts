// Shared PGlite test setup for this package's suites. Boots a fresh in-memory
// instance from the process's migrated snapshot (`src/pglite-snapshot`) and
// wraps it as the opaque `AppDatabase` the repository consumes.
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { onTestFinished } from "vitest";
import { type AppDatabase, fromDrizzle } from "../src/db/handle";
import { migratedPglite } from "../src/pglite-snapshot";
import * as schema from "../src/schema/index";

/**
 * A migrated, isolated PGlite that closes itself when the test ends.
 *
 * The close is critical, not hygiene: a live instance pins ~215MB of WASM
 * heap that V8 never reclaims on its own, so one leaked instance per test
 * walks the suite into swap and produces unrelated timeouts. Registering the
 * cleanup here rather than in each suite means no caller can forget it.
 */
export async function freshPglite(): Promise<PGlite> {
  const client = await migratedPglite();
  onTestFinished(async () => {
    if (!client.closed) await client.close();
  });
  return client;
}

/** A migrated, isolated database wrapped as the opaque handle. */
export async function freshDatabase(): Promise<AppDatabase> {
  return fromDrizzle(drizzle(await freshPglite(), { schema }));
}

/** Brand a bigint via its guard — the sanctioned no-`as` path. */
export function brandWith<T extends bigint>(
  guard: (value: bigint) => value is T,
  value: bigint,
): T {
  if (!guard(value)) {
    throw new Error(`test fixture id failed its brand guard: ${value}`);
  }
  return value;
}
