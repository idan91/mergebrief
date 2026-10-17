// Migration 0054 data test, same posture as migration-0039.test.ts: the
// rewrite must run against PRE-migration rows, which the shared harness (all
// migrations upfront, empty DB) cannot express. Applies 0000 to 0053 raw,
// seeds a two-PR brief chain with JSON text ids, applies 0054, and reads the
// native arrays back.
import { describe, expect, it } from "vitest";
import {
  applyMigrationFile,
  MIGRATION_REPLAY_TIMEOUT_MS,
  pgliteBefore,
} from "./helpers";

interface IdColumnsRow {
  readonly pr_number: number;
  readonly head_index: number;
  readonly carried_chunk_ids: string[] | null;
  readonly used_group_ids: string[] | null;
}

interface ColumnTypeRow {
  readonly column_name: string;
  readonly data_type: string;
  readonly udt_name: string;
}

function buildBody(groupIds: readonly string[]): string {
  const changeGroups = groupIds.map((id) => ({ id }));
  return JSON.stringify({ changeGroups });
}

async function readIdColumns(
  client: Awaited<ReturnType<typeof pgliteBefore>>["client"],
): Promise<IdColumnsRow[]> {
  const result = await client.query<IdColumnsRow>(`
    select pr.pr_number, b.head_index, b.carried_chunk_ids, b.used_group_ids
    from brief b join pull_request pr on pr.id = b.pull_request_id
    order by pr.pr_number, b.head_index
  `);
  return result.rows;
}

describe(
  "migration 0054 id lists as text arrays",
  { timeout: MIGRATION_REPLAY_TIMEOUT_MS },
  () => {
    it("converts JSON text ids to arrays and backfills used_group_ids", async () => {
      const { client, target } = await pgliteBefore("0054_");

      await client.exec(`
      insert into pull_request (installation_id, repo_id, pr_number, repo_slug, state)
      values (4242, 99, 7, 'acme/widgets', 'open'),
             (4242, 99, 8, 'acme/widgets', 'open');
      insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index,
                         commit_count, provider, model, effort, body, byte_size,
                         carried_chunk_ids, used_group_ids)
      select 4242, id, 'base', 'head-0', 0, 1, 'anthropic', 'claude', 'high',
             '{}', 2, null, null
      from pull_request where pr_number = 7;
      insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index,
                         commit_count, provider, model, effort, body, byte_size,
                         carried_chunk_ids, used_group_ids)
      select 4242, id, 'base', 'head-1', 1, 1, 'anthropic', 'claude', 'high',
             '${buildBody(["gA", "gB"])}', 1, null, null
      from pull_request where pr_number = 7;
      insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index,
                         commit_count, provider, model, effort, body, byte_size,
                         carried_chunk_ids, used_group_ids)
      select 4242, id, 'base', 'head-2', 2, 2, 'anthropic', 'claude', 'high',
             '${buildBody(["gB", "gC"])}', 1, '["c1","c2"]', null
      from pull_request where pr_number = 7;
      insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index,
                         commit_count, provider, model, effort, body, byte_size,
                         carried_chunk_ids, used_group_ids)
      select 4242, id, 'base', 'head-3', 3, 3, 'anthropic', 'claude', 'high',
             '${buildBody(["gD"])}', 1, '[]', '["gA","gB","gC","gD"]'
      from pull_request where pr_number = 7;
      insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index,
                         commit_count, provider, model, effort, body, byte_size,
                         carried_chunk_ids, used_group_ids)
      select 4242, id, 'base', 'head-1', 1, 1, 'anthropic', 'claude', 'high',
             '${buildBody(["gZ", "gA"])}', 1, null, null
      from pull_request where pr_number = 8;
    `);

      await applyMigrationFile(client, target);

      expect(await readIdColumns(client)).toEqual([
        {
          pr_number: 7,
          head_index: 0,
          carried_chunk_ids: null,
          used_group_ids: [],
        },
        {
          pr_number: 7,
          head_index: 1,
          carried_chunk_ids: null,
          used_group_ids: ["gA", "gB"],
        },
        {
          pr_number: 7,
          head_index: 2,
          carried_chunk_ids: ["c1", "c2"],
          used_group_ids: ["gA", "gB", "gC"],
        },
        {
          pr_number: 7,
          head_index: 3,
          carried_chunk_ids: [],
          used_group_ids: ["gA", "gB", "gC", "gD"],
        },
        {
          pr_number: 8,
          head_index: 1,
          carried_chunk_ids: null,
          used_group_ids: ["gZ", "gA"],
        },
      ]);

      const types = await client.query<ColumnTypeRow>(`
      select column_name, data_type, udt_name from information_schema.columns
      where table_name = 'brief' and column_name in ('carried_chunk_ids', 'used_group_ids')
      order by column_name
    `);
      expect(types.rows).toEqual([
        {
          column_name: "carried_chunk_ids",
          data_type: "ARRAY",
          udt_name: "_text",
        },
        {
          column_name: "used_group_ids",
          data_type: "ARRAY",
          udt_name: "_text",
        },
      ]);
    });

    it("fails loudly on a stored id value that is not a JSON array", async () => {
      const { client, target } = await pgliteBefore("0054_");

      await client.exec(`
      insert into pull_request (installation_id, repo_id, pr_number, repo_slug, state)
      values (4242, 99, 7, 'acme/widgets', 'open');
      insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index,
                         commit_count, provider, model, effort, body, byte_size,
                         carried_chunk_ids)
      select 4242, id, 'base', 'head-1', 1, 1, 'anthropic', 'claude', 'high',
             '{}', 2, 'not json'
      from pull_request where pr_number = 7;
    `);

      await expect(applyMigrationFile(client, target)).rejects.toThrow(
        "invalid input syntax for type json",
      );
    });
  },
);
