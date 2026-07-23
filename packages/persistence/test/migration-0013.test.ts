// Migration 0013 backfill test (BRIEF-40, D15). The only migration so far
// with a data transform: it must be exercised against PRE-migration data,
// which the shared `freshDatabase` harness (all migrations upfront) cannot
// express. So this suite applies 0000–0012 raw, seeds old-shape rows
// (ciphertext columns still on `reviewer_session`/`api_token`), applies 0013,
// and asserts the dedup semantics:
//   - a not-yet-diverged token (byte-identical ciphertext triple — mint
//     copied verbatim) joins its source session's grant;
//   - a diverged token (its own pair) gets its own grant;
//   - `refresh_expires_at` comes from the session arm's `expires_at`, with
//     the ~6-month fallback for a triple no session carries;
//   - the old columns are gone afterwards.
// The `--> statement-breakpoint` markers are SQL comments, so each file
// executes wholesale.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .toSorted((a, b) => a.localeCompare(b));
}

async function applyFile(client: PGlite, name: string): Promise<void> {
  await client.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
}

describe("migration 0013 — grant backfill (D15)", () => {
  it("dedups shared pairs into one grant, isolates diverged ones, drops the old columns", async () => {
    const client = new PGlite();
    const files = migrationFiles();
    const target = files.find((name) => name.startsWith("0013_"));
    if (target === undefined) throw new Error("0013 migration file not found");
    for (const name of files) {
      if (name === target) break;
      await applyFile(client, name);
    }

    // Old-shape seed. S1 + T1 share pair P1 byte-for-byte (the verbatim mint
    // copy); T2 holds diverged pair P2; S2 holds its own pair P3.
    await client.exec(`
      insert into reviewer_session (installation_id, session_token_hash, reviewer_id, reviewer_login, gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref, expires_at)
      values
        (4242, 'hash-s1', 777, 'octocat', 'P1.access', 'P1.refresh', 'K1', '2027-01-01T00:00:00Z'),
        (4242, 'hash-s2', 888, 'hubber',  'P3.access', 'P3.refresh', 'K1', '2027-03-01T00:00:00Z');
      insert into api_token (installation_id, token_hash, user_id, name, gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref, expires_at)
      values
        (4242, 'hash-t1', 777, 'shared-pair',   'P1.access', 'P1.refresh', 'K1', null),
        (4242, 'hash-t2', 777, 'diverged-pair', 'P2.access', 'P2.refresh', 'K1', '2026-10-01T00:00:00Z');
    `);

    await applyFile(client, target);

    // Three distinct triples → exactly three grants.
    const grants = await client.query<{
      id: string;
      gh_token_ciphertext: string;
      refresh_expires_at: string;
    }>(
      "select id::text, gh_token_ciphertext, refresh_expires_at::text from github_grant order by gh_token_ciphertext",
    );
    expect(grants.rows.map((row) => row.gh_token_ciphertext)).toEqual([
      "P1.access",
      "P2.access",
      "P3.access",
    ]);

    const links = await client.query<{ hash: string; grant_id: string }>(`
      select session_token_hash as hash, grant_id::text from reviewer_session
      union all
      select token_hash as hash, grant_id::text from api_token
    `);
    const byHash = new Map(links.rows.map((row) => [row.hash, row.grant_id]));
    const grantByPair = new Map(grants.rows.map((row) => [row.gh_token_ciphertext, row.id]));

    // Shared pair → shared grant; diverged/own pairs → own grants.
    expect(byHash.get("hash-s1")).toBe(grantByPair.get("P1.access"));
    expect(byHash.get("hash-t1")).toBe(grantByPair.get("P1.access"));
    expect(byHash.get("hash-t2")).toBe(grantByPair.get("P2.access"));
    expect(byHash.get("hash-s2")).toBe(grantByPair.get("P3.access"));

    // refresh_expires_at: session-carried for P1/P3; ~6mo fallback for P2
    // (token-only triple — its mint expiry must NOT leak into the grant).
    const expiryByPair = new Map(
      grants.rows.map((row) => [row.gh_token_ciphertext, new Date(row.refresh_expires_at)]),
    );
    expect(expiryByPair.get("P1.access")).toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(expiryByPair.get("P3.access")).toEqual(new Date("2027-03-01T00:00:00Z"));
    const fallback = expiryByPair.get("P2.access");
    if (fallback === undefined) throw new Error("missing P2 grant");
    const monthsOut = (fallback.getTime() - Date.now()) / (30 * 24 * 3_600_000);
    expect(monthsOut).toBeGreaterThan(5);
    expect(monthsOut).toBeLessThan(7);

    // The old columns are gone from both referent tables.
    const oldColumns = await client.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('reviewer_session', 'api_token')
        and column_name in ('gh_token_ciphertext', 'gh_refresh_token_ciphertext', 'key_ref')
    `);
    expect(oldColumns.rows).toHaveLength(0);
  });
});
