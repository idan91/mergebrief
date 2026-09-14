// Migration 0036 data test, same posture as migration-0017.test.ts: the
// rewrite must run against PRE-migration rows, which the shared harness (all
// migrations upfront, empty DB) cannot express. Applies 0000 to 0035 raw,
// seeds a `queued` generation row, applies 0036, and reads it back.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { GenerationStatuses } from "../src/types";

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .toSorted((a, b) => a.localeCompare(b));
}

async function applyFile(client: PGlite, name: string): Promise<void> {
  await client.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
}

/** The literals a CHECK constraint accepts. */
async function readCheckValues(
  client: PGlite,
  constraintName: string,
): Promise<string[]> {
  const result = await client.query<{ def: string }>(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
    [constraintName],
  );
  const def = result.rows[0]?.def;
  if (def === undefined) {
    throw new Error(`constraint ${constraintName} not found`);
  }
  return [...def.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "");
}

describe("migration 0036 generation pending", () => {
  it("rewrites queued rows to pending and leaves terminal rows alone", async () => {
    const client = new PGlite();
    const files = migrationFiles();
    const target = files.find((name) => name.startsWith("0036_"));
    if (target === undefined) throw new Error("0036 migration file not found");
    for (const name of files) {
      if (name === target) break;
      await applyFile(client, name);
    }

    await client.exec(`
      insert into pull_request (installation_id, repo_id, pr_number, repo_slug, state)
      values (4242, 99, 7, 'acme/widgets', 'open');
      insert into generation (installation_id, pull_request_id, kind, head_sha, status)
      select 4242, id, 'brief', 'head-waiting', 'queued' from pull_request where pr_number = 7;
      insert into generation (installation_id, pull_request_id, kind, head_sha, status)
      select 4242, id, 'brief', 'head-done', 'succeeded' from pull_request where pr_number = 7;
    `);

    await applyFile(client, target);

    const rows = await client.query<{ head_sha: string; status: string }>(
      "select head_sha, status from generation order by head_sha",
    );
    expect(rows.rows).toEqual([
      { head_sha: "head-done", status: "succeeded" },
      { head_sha: "head-waiting", status: "pending" },
    ]);

    expect(
      (await readCheckValues(client, "generation_status_check")).toSorted(),
    ).toEqual(Object.values(GenerationStatuses).toSorted());
    await client.close();
  });
});
