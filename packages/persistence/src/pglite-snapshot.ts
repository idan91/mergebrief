// Migration-cost amortization for the PGlite test harnesses.
//
// Migrating a virgin PGlite costs ~0.6s and every harness call used to pay it,
// which under coverage instrumentation pushed setups past the 5s hook timeout.
// Instead: migrate ONCE, `dumpDataDir()` the migrated cluster, and boot every
// instance from that snapshot via `loadDataDir` (~0.12s). Per-test isolation is
// unchanged — only the migration work is shared.
//
// Two levels of sharing, because vitest gives each test FILE its own process
// and each package its own vitest run:
//   - an in-process memo, so a file's tests migrate at most once between them;
//   - a content-addressed file in `os.tmpdir()`, so every other worker,
//     package and subsequent run reuses the same migrated cluster.
// The cache key digests every input the snapshot is a function of, so a stale
// snapshot can never be read; test/pglite-snapshot.test.ts pins that.
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const CACHE_DIR = join(tmpdir(), "mergebrief-pglite-snapshots");

/**
 * Digest of every input the snapshot is derived from. The folder parameter
 * exists for the key-completeness test only — production callers always
 * digest the checked-in migrations.
 */
export async function deriveSnapshotKey(
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<string> {
  const digest = createHash("sha256");
  // Under pnpm these paths carry the exact versions, so upgrading PGlite
  // (which may move the data-dir format) or drizzle-orm (whose migrator
  // decides how the SQL is applied) invalidates the cache on its own.
  const require = createRequire(import.meta.url);
  digest.update(require.resolve("@electric-sql/pglite"));
  digest.update(require.resolve("drizzle-orm/pglite/migrator"));
  // Drizzle's migrator takes the applied set, ORDER, and statement-breakpoint
  // splitting from meta/_journal.json — a journal-only change with
  // byte-identical .sql files still needs a new key.
  digest.update(
    await readFile(join(migrationsFolder, "meta", "_journal.json")),
  );
  const names = (await readdir(migrationsFolder))
    .filter((name) => name.endsWith(".sql"))
    .toSorted((a, b) => a.localeCompare(b));
  const migrations = await Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(join(migrationsFolder, name)),
    })),
  );
  for (const migration of migrations) {
    digest.update(migration.name);
    digest.update(migration.sql);
  }
  return digest.digest("hex").slice(0, 32);
}

async function buildSnapshot(): Promise<Uint8Array> {
  const seed = new PGlite();
  await migrate(drizzle(seed), { migrationsFolder: MIGRATIONS_FOLDER });
  // Uncompressed on purpose: `gzip` shrinks the dump ~41MB → ~4.7MB but adds
  // ~70ms of inflate to EVERY instance — the wrong trade for bytes that only
  // ever travel between this process and a local temp file.
  const dump = await seed.dumpDataDir("none");
  await seed.close();
  return new Uint8Array(await dump.arrayBuffer());
}

/** Path of the cached snapshot, migrating and writing it if it is missing. */
async function snapshotFile(): Promise<string> {
  const file = join(CACHE_DIR, `${await deriveSnapshotKey()}.tar`);
  const cached = await access(file).then(
    () => true,
    () => false,
  );
  if (cached) return file;

  // Publish under a per-process staging name and rename: on a cold cache every
  // worker builds concurrently, and a half-written file must never become
  // readable under the final name. Concurrent builders produce identical bytes,
  // so the last rename winning is harmless.
  await mkdir(CACHE_DIR, { recursive: true });
  const staging = `${file}.${process.pid}.staging`;
  await writeFile(staging, await buildSnapshot());
  await rename(staging, file);
  return file;
}

/**
 * Build the snapshot without booting an instance. A vitest `globalSetup` calls
 * this so the cold-cache migration happens once, before the workers fork,
 * instead of inside whichever test each worker reaches first.
 */
export async function warmPgliteSnapshot(): Promise<void> {
  await snapshotFile();
}

/**
 * Process-wide memo. A rejected promise stays memoized on purpose — a broken
 * migration set is an infra error, and re-running it per caller would only
 * multiply the failure output.
 */
let snapshot: Promise<Blob> | undefined;

function migratedSnapshot(): Promise<Blob> {
  snapshot ??= snapshotFile()
    .then(readFile)
    .then((bytes) => new Blob([bytes]));
  return snapshot;
}

/** A fresh, isolated, fully migrated in-memory PGlite. */
export async function createMigratedPglite(): Promise<PGlite> {
  return PGlite.create({ loadDataDir: await migratedSnapshot() });
}
