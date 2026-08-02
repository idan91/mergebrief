// Key-completeness invariant for the snapshot cache (BRIEF-114, #208 review):
// every migration input must move the key. If a change to the migrations
// directory can leave the key unchanged, a warm cache serves a stale schema —
// silently, and only on machines that had the old snapshot.
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { snapshotKey } from "../src/pglite-snapshot";

const REAL_MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

async function migrationsCopy(): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "snapkey-"));
  onTestFinished(() => rm(scratch, { recursive: true, force: true }));
  const dir = join(scratch, "drizzle-copy");
  await cp(REAL_MIGRATIONS, dir, { recursive: true });
  return dir;
}

describe("snapshotKey", () => {
  it("is stable and content-addressed, not path-addressed", async () => {
    const dir = await migrationsCopy();
    expect(await snapshotKey(dir)).toBe(await snapshotKey(dir));
    expect(await snapshotKey(dir)).toBe(await snapshotKey(REAL_MIGRATIONS));
  });

  it("changes when a migration SQL file changes", async () => {
    const dir = await migrationsCopy();
    const baseline = await snapshotKey(dir);
    const firstSql = (await readdir(dir)).find((n) => n.endsWith(".sql"));
    if (firstSql === undefined) throw new Error("no migrations in copy");
    const path = join(dir, firstSql);
    await writeFile(path, `${await readFile(path, "utf8")}\n-- key probe`);
    expect(await snapshotKey(dir)).not.toBe(baseline);
  });

  it("changes on a journal-only change with byte-identical SQL", async () => {
    const dir = await migrationsCopy();
    const baseline = await snapshotKey(dir);
    const journalPath = join(dir, "meta", "_journal.json");
    const journal = await readFile(journalPath, "utf8");
    await writeFile(journalPath, journal.replace(/}\s*$/, " }"));
    expect(await snapshotKey(dir)).not.toBe(baseline);
  });
});
