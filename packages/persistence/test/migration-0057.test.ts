// Migration 0057 data test, same posture as migration-0054.test.ts: the
// column drop must run against PRE-migration rows, which the shared harness
// (all migrations upfront, empty DB) cannot express. Applies 0000 to 0056
// raw, seeds one row per lifecycle with the old sweep column armed, applies
// 0057, and reads the rows back.
import { describe, expect, it } from "vitest";
import { applyMigrationFile, pgliteBefore } from "./helpers";

interface LifecycleRow {
  readonly pr_number: number;
  readonly state: string;
  readonly closed_at: Date | null;
}

interface IndexRow {
  readonly indexname: string;
  readonly indexdef: string;
}

describe("migration 0057 pull request retention by closed_at", () => {
  it("keeps every row's close time and drops purge_after with its index", async () => {
    const { client, target } = await pgliteBefore("0057_");

    await client.exec(`
      insert into pull_request (installation_id, owner_user_id, source, repo_id, pr_number, state, closed_at, purge_after)
      values (4242, null, 'installation', 99, 7, 'open', null, null),
             (4242, null, 'installation', 99, 8, 'closed', '2026-07-01T00:00:00Z', '2026-07-31T00:00:00Z'),
             (4242, null, 'installation', 99, 9, 'merged', '2026-07-02T00:00:00Z', null),
             (null, 501, 'url', 99, 10, 'merged', '2026-07-03T00:00:00Z', '2026-08-02T00:00:00Z');
    `);

    await applyMigrationFile(client, target);

    const rows = await client.query<LifecycleRow>(
      "select pr_number, state, closed_at from pull_request order by pr_number",
    );
    expect(rows.rows).toEqual([
      { pr_number: 7, state: "open", closed_at: null },
      {
        pr_number: 8,
        state: "closed",
        closed_at: new Date("2026-07-01T00:00:00Z"),
      },
      {
        pr_number: 9,
        state: "merged",
        closed_at: new Date("2026-07-02T00:00:00Z"),
      },
      {
        pr_number: 10,
        state: "merged",
        closed_at: new Date("2026-07-03T00:00:00Z"),
      },
    ]);

    const columns = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'pull_request' and column_name = 'purge_after'",
    );
    expect(columns.rows).toEqual([]);

    const indexes = await client.query<IndexRow>(
      "select indexname, indexdef from pg_indexes where tablename = 'pull_request' and indexname in ('pull_request_purge_after_idx', 'pull_request_closed_at_idx')",
    );
    expect(indexes.rows).toEqual([
      {
        indexname: "pull_request_closed_at_idx",
        indexdef:
          "CREATE INDEX pull_request_closed_at_idx ON public.pull_request USING btree (closed_at) WHERE (closed_at IS NOT NULL)",
      },
    ]);
  });

  it("still refuses an open row that carries a close time", async () => {
    const { client, target } = await pgliteBefore("0057_");
    await applyMigrationFile(client, target);

    await expect(
      client.exec(
        "insert into pull_request (installation_id, repo_id, pr_number, state, closed_at) values (4242, 99, 7, 'open', now())",
      ),
    ).rejects.toThrow("pull_request_open_retention_shape");
  });
});
