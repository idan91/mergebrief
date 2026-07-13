// Shared PGlite test setup for the tenant-repository suite. Applies the
// checked-in migrations to a fresh in-memory PGlite instance and wraps it as
// the opaque `AppDatabase` the repository consumes.
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type AppDatabase, fromDrizzle } from "../src/db/handle";
import * as schema from "../src/schema/index";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** A migrated, isolated database wrapped as the opaque handle. */
export async function freshDatabase(): Promise<AppDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return fromDrizzle(db);
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
