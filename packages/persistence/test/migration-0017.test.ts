// Migration 0017 backfill test, same posture as migration-0013.test.ts: the
// data transform must run against PRE-migration rows, which the shared
// harness (all migrations upfront, empty DB) cannot express. Applies
// 0000–0016 raw, seeds old-shape `generation` rows (free-text `error`),
// applies 0017, and asserts the migrate-not-wipe semantics.
import { describe, expect, it } from "vitest";
import { applyMigrationFile, pgliteBefore } from "./helpers";

describe("migration 0017 generation failure codes", () => {
  it("backfills failure text as unknown detail and drops the column", async () => {
    const { client, target } = await pgliteBefore("0017_");

    await client.exec(`
      insert into pull_request (installation_id, repo_id, pr_number, repo_slug, state)
      values (4242, 99, 7, 'acme/widgets', 'open');
      insert into generation (installation_id, pull_request_id, kind, head_sha, status, error)
      select 4242, id, 'brief', 'head-failed', 'failed', 'connect ECONNREFUSED [redacted-url] retrying'
      from pull_request where pr_number = 7;
      insert into generation (installation_id, pull_request_id, kind, head_sha, status, error)
      select 4242, id, 'brief', 'head-clean', 'succeeded', null
      from pull_request where pr_number = 7;
    `);

    await applyMigrationFile(client, target);

    const rows = await client.query<{
      head_sha: string;
      error_code: string | null;
      detail: string | null;
    }>(
      "select head_sha, error_code, error_params->>'detail' as detail from generation order by head_sha",
    );
    expect(rows.rows).toEqual([
      {
        head_sha: "head-clean",
        error_code: null,
        detail: null,
      },
      {
        head_sha: "head-failed",
        error_code: "unknown",
        detail: "connect ECONNREFUSED [redacted-url] retrying",
      },
    ]);

    // The old column is gone; the CHECK rejects out-of-vocabulary codes.
    const oldColumn = await client.query(`
      select column_name from information_schema.columns
      where table_schema = 'public'
        and table_name = 'generation'
        and column_name = 'error'
    `);
    expect(oldColumn.rows).toHaveLength(0);
    await expect(
      client.query(
        `update generation set error_code = 'not-a-code' where head_sha = 'head-failed'`,
      ),
    ).rejects.toThrow(/generation_error_code_check/);
  });
});
