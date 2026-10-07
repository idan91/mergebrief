// Migration 0013 backfill test: the data transform runs against
// PRE-migration rows, which the shared harness (all migrations upfront)
// cannot express. Applies 0000 to 0012 raw, seeds old-shape rows with the
// ciphertext columns still on `reviewer_session` and `api_token`, applies
// 0013, and asserts the dedup semantics: an undiverged token (byte-identical
// triple) joins its source session's grant, a diverged one gets its own,
// `refresh_expires_at` comes from the session arm with the six-month
// fallback, and the old columns are gone.
import { describe, expect, it } from "vitest";
import { applyMigrationFile, pgliteBefore } from "./helpers";

describe("migration 0013 grant backfill", () => {
  it("dedups shared pairs, isolates diverged ones, drops the old columns", async () => {
    const { client, target } = await pgliteBefore("0013_");

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

    await applyMigrationFile(client, target);

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
    const grantByPair = new Map(
      grants.rows.map((row) => [row.gh_token_ciphertext, row.id]),
    );

    // Shared pair → shared grant; diverged/own pairs → own grants.
    expect(byHash.get("hash-s1")).toBe(grantByPair.get("P1.access"));
    expect(byHash.get("hash-t1")).toBe(grantByPair.get("P1.access"));
    expect(byHash.get("hash-t2")).toBe(grantByPair.get("P2.access"));
    expect(byHash.get("hash-s2")).toBe(grantByPair.get("P3.access"));

    // refresh_expires_at: session-carried for P1/P3; ~6mo fallback for P2
    // (token-only triple; its mint expiry must NOT leak into the grant).
    const expiryByPair = new Map(
      grants.rows.map((row) => [
        row.gh_token_ciphertext,
        new Date(row.refresh_expires_at),
      ]),
    );
    expect(expiryByPair.get("P1.access")).toEqual(
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(expiryByPair.get("P3.access")).toEqual(
      new Date("2027-03-01T00:00:00Z"),
    );
    const fallback = expiryByPair.get("P2.access");
    if (fallback === undefined) {
      throw new Error("missing P2 grant");
    }
    const monthsOut = (fallback.getTime() - Date.now()) / (30 * 24 * 3_600_000);
    expect(monthsOut).toBeGreaterThan(5);
    expect(monthsOut).toBeLessThan(7);

    // The old columns are gone from both referent tables.
    const oldColumns = await client.query<{
      table_name: string;
      column_name: string;
    }>(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('reviewer_session', 'api_token')
        and column_name in ('gh_token_ciphertext', 'gh_refresh_token_ciphertext', 'key_ref')
    `);
    expect(oldColumns.rows).toHaveLength(0);
  });
});
