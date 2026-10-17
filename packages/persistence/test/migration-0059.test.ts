// Migration 0059 data test, same posture as migration-0054.test.ts: the
// backfill must run against PRE-migration rows, which the shared harness (all
// migrations upfront, empty DB) cannot express. Applies 0000 to 0058 raw,
// seeds briefs with and without a chain record, applies 0059, and reads the
// chains back.
import { describe, expect, it } from "vitest";
import {
  applyMigrationFile,
  MIGRATION_REPLAY_TIMEOUT_MS,
  pgliteBefore,
} from "./helpers";

interface ChainRow {
  readonly pr_number: number;
  readonly head_index: number;
  readonly used_group_ids: string[];
}

function buildBody(groupIds: readonly string[]): string {
  const changeGroups = groupIds.map((id) => ({ id }));
  return JSON.stringify({ changeGroups });
}

function buildBriefInsert(
  prNumber: number,
  headIndex: number,
  body: string,
  usedGroupIds: string,
): string {
  return `
    insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index,
                       commit_count, provider, model, effort, body, byte_size, used_group_ids)
    select 4242, id, 'base', 'head-${headIndex}', ${headIndex}, 1, 'anthropic', 'claude', 'high',
           '${body}', 1, ${usedGroupIds}
    from pull_request where pr_number = ${prNumber};
  `;
}

describe(
  "migration 0059 used_group_ids not null",
  { timeout: MIGRATION_REPLAY_TIMEOUT_MS },
  () => {
    it("backfills a missing chain from earlier rows and bodies", async () => {
      const { client, target } = await pgliteBefore("0059_");

      const seedBriefs = [
        buildBriefInsert(7, 1, buildBody(["gA", "gB"]), "'{gA,gB,gX}'"),
        buildBriefInsert(7, 2, buildBody(["gB", "gC"]), "null"),
        buildBriefInsert(7, 3, buildBody(["gD"]), "'{gA,gB,gX,gC,gD}'"),
        buildBriefInsert(8, 1, "{}", "null"),
      ].join("\n");
      await client.exec(`
      insert into pull_request (installation_id, repo_id, pr_number, repo_slug, state)
      values (4242, 99, 7, 'acme/widgets', 'open'),
             (4242, 99, 8, 'acme/widgets', 'open');
      ${seedBriefs}
    `);

      await applyMigrationFile(client, target);

      const chains = await client.query<ChainRow>(`
      select pr.pr_number, b.head_index, b.used_group_ids
      from brief b join pull_request pr on pr.id = b.pull_request_id
      order by pr.pr_number, b.head_index
    `);
      expect(chains.rows).toEqual([
        { pr_number: 7, head_index: 1, used_group_ids: ["gA", "gB", "gX"] },
        {
          pr_number: 7,
          head_index: 2,
          used_group_ids: ["gA", "gB", "gX", "gC"],
        },
        {
          pr_number: 7,
          head_index: 3,
          used_group_ids: ["gA", "gB", "gX", "gC", "gD"],
        },
        { pr_number: 8, head_index: 1, used_group_ids: [] },
      ]);

      const nullable = await client.query<{ is_nullable: string }>(`
      select is_nullable from information_schema.columns
      where table_name = 'brief' and column_name = 'used_group_ids'
    `);
      expect(nullable.rows).toEqual([{ is_nullable: "NO" }]);
    });
  },
);
