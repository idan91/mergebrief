// Migration 0064 data test, same posture as migration-0061.test.ts: the
// triggered_at backfill must run against PRE-migration rows. Applies 0000 to
// 0063 raw, seeds generation rows, applies 0064, and reads the order back.
import { describe, expect, it } from "vitest";
import {
  applyMigrationFile,
  MIGRATION_REPLAY_TIMEOUT_MS,
  pgliteBefore,
} from "./helpers";

type MigrationClient = Awaited<ReturnType<typeof pgliteBefore>>["client"];

interface HeadRow {
  readonly head_sha: string;
}

async function seedGenerations(client: MigrationClient): Promise<void> {
  await client.exec(`
    insert into pull_request (installation_id, repo_id, pr_number, repo_slug, state)
    values (4242, 99, 7, 'acme/widgets', 'open'),
           (4242, 99, 8, 'acme/widgets', 'closed');
    insert into generation (installation_id, pull_request_id, kind, head_sha, status, updated_at)
    select 4242, id, 'brief', 'current', 'succeeded', timestamptz '2026-10-01 10:00:00+00'
      from pull_request where pr_number = 7
    union all
    select 4242, id, 'brief', 'swept', 'superseded', timestamptz '2026-10-01 11:00:00+00'
      from pull_request where pr_number = 7
    union all
    select 4242, id, 'brief', 'older', 'succeeded', timestamptz '2026-09-30 10:00:00+00'
      from pull_request where pr_number = 7
    union all
    select 4242, id, 'brief', 'closed-early', 'superseded', timestamptz '2026-09-01 10:00:00+00'
      from pull_request where pr_number = 8
    union all
    select 4242, id, 'brief', 'closed-late', 'superseded', timestamptz '2026-09-02 10:00:00+00'
      from pull_request where pr_number = 8;
  `);
}

async function readNewestHead(
  client: MigrationClient,
  prNumber: number,
): Promise<string | undefined> {
  const result = await client.query<HeadRow>(
    `select generation.head_sha from generation
       join pull_request on pull_request.id = generation.pull_request_id
      where pull_request.pr_number = $1
      order by generation.triggered_at desc, generation.id desc
      limit 1`,
    [prNumber],
  );
  return result.rows[0]?.head_sha;
}

describe(
  "migration 0064 generation triggered_at backfill",
  { timeout: MIGRATION_REPLAY_TIMEOUT_MS },
  () => {
    it("ranks a swept superseded row below the head it was swept for", async () => {
      const { client, target } = await pgliteBefore("0064_");
      await seedGenerations(client);

      await applyMigrationFile(client, target);

      expect(await readNewestHead(client, 7)).toBe("current");
    });

    it("keeps each live row's last write as its trigger time", async () => {
      const { client, target } = await pgliteBefore("0064_");
      await seedGenerations(client);

      await applyMigrationFile(client, target);

      const result = await client.query<{ same: boolean }>(
        "select bool_and(triggered_at = updated_at) as same from generation where status <> 'superseded'",
      );
      expect(result.rows[0]?.same).toBe(true);
    });

    it("still reads an all-superseded PR's newest row first", async () => {
      const { client, target } = await pgliteBefore("0064_");
      await seedGenerations(client);

      await applyMigrationFile(client, target);

      expect(await readNewestHead(client, 8)).toBe("closed-late");
    });
  },
);
