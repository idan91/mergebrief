// Migration 0024 backfill test — same posture as migration-0017.test.ts: the
// transform must run against PRE-migration rows, which the shared harness (all
// migrations upfront, empty DB) cannot express. Applies 0000–0023 raw, seeds
// scope-less tokens, applies 0024, and asserts every existing credential keeps
// the reach it had rather than being narrowed on deploy day.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { WriteClassifications } from "../src/types";

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .toSorted((a, b) => a.localeCompare(b));
}

async function applyFile(client: PGlite, name: string): Promise<void> {
  await client.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
}

describe("migration 0024 — api_token.scope", () => {
  it("backfills existing tokens to external-write and pins the vocabulary", async () => {
    const client = new PGlite();
    const files = migrationFiles();
    const target = files.find((name) => name.startsWith("0024_"));
    if (target === undefined) throw new Error("0024 migration file not found");
    for (const name of files) {
      if (name === target) break;
      await applyFile(client, name);
    }

    await client.exec(`
      insert into github_grant
        (gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref, refresh_expires_at)
      values ('enc-access', 'enc-refresh', 'SESSION_KEY_V1', now() + interval '1 day');
      insert into api_token
        (installation_id, token_hash, user_id, name, grant_id, expires_at)
      select 4242, 'hash-live', 99, 'ci-token', id, null from github_grant;
      insert into api_token
        (installation_id, token_hash, user_id, name, grant_id, revoked_at)
      select 4242, 'hash-revoked', 99, 'old-token', id, now() from github_grant;
    `);

    await applyFile(client, target);

    // A read-only backfill would 403 every running CLI, revoked rows included
    // (they stay listable, so their scope must still read honestly).
    const rows = await client.query<{ token_hash: string; scope: string }>(
      "select token_hash, scope from api_token order by token_hash",
    );
    expect(rows.rows).toEqual([
      { token_hash: "hash-live", scope: WriteClassifications.EXTERNAL_WRITE },
      {
        token_hash: "hash-revoked",
        scope: WriteClassifications.EXTERNAL_WRITE,
      },
    ]);

    // The DEFAULT was scaffolding for the backfill — a later mint must choose.
    const defaults = await client.query<{ column_default: string | null }>(`
      select column_default from information_schema.columns
      where table_schema = 'public'
        and table_name = 'api_token'
        and column_name = 'scope'
    `);
    expect(defaults.rows[0]?.column_default).toBeNull();

    // CHECK and `as const` map in lockstep, same shape as every other
    // DB-stored vocabulary.
    const constraint = await client.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'api_token_scope_check'",
    );
    const accepted = [
      ...(constraint.rows[0]?.def ?? "").matchAll(/'([^']*)'/g),
    ].map((match) => match[1] ?? "");
    expect(accepted.toSorted()).toEqual(
      Object.values(WriteClassifications).toSorted(),
    );
  });
});
