import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import {
  copyMigrationsBefore,
  MIGRATION_REPLAY_TIMEOUT_MS,
  virginPglite,
} from "./helpers";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const ID_SPACE_TAG = "0081_generation-part-id-space";
const ANCHOR_PLAN_TAG = "0086_grouping-part-anchor-plan";

describe("generation part id space migration", () => {
  it(
    "deletes every part stored before the renumbered grouping",
    async () => {
      const client = await virginPglite();
      await migrate(drizzle(client), {
        migrationsFolder: await copyMigrationsBefore(ID_SPACE_TAG),
      });
      await client.exec(`
        insert into pull_request (installation_id, repo_id, pr_number, state)
          values (1, 11, 1, 'open');
        insert into generation_part (installation_id, pull_request_id, base_sha, head_sha, part_key, body, byte_size)
          select 1, id, 'base', 'head', 'grouping', '{}', 2 from pull_request
          union all
          select 1, id, 'base', 'head', 'detail:1', '{}', 2 from pull_request
          union all
          select 1, id, 'base', 'head', 'detail:2:a', '{}', 2 from pull_request;
      `);

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      const parts = await client.query<{ part_key: string }>(
        "select part_key from generation_part",
      );
      expect(parts.rows).toEqual([]);
    },
    MIGRATION_REPLAY_TIMEOUT_MS,
  );
});

describe("grouping part anchor plan migration", () => {
  it(
    "deletes only grouping parts stored without an anchor plan digest",
    async () => {
      const client = await virginPglite();
      await migrate(drizzle(client), {
        migrationsFolder: await copyMigrationsBefore(ANCHOR_PLAN_TAG),
      });
      await client.exec(`
        insert into pull_request (installation_id, repo_id, pr_number, state)
          values (1, 11, 1, 'open');
        insert into generation_part (installation_id, pull_request_id, base_sha, head_sha, part_key, body, byte_size)
          select 1, id, 'base', 'old', 'grouping', '{"kind":"grouping"}', 19 from pull_request
          union all
          select 1, id, 'base', 'old', 'detail:1', '{"kind":"detail"}', 17 from pull_request
          union all
          select 1, id, 'base', 'new', 'grouping', '{"kind":"grouping","anchorPlanDigest":"d"}', 42 from pull_request;
      `);

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      const parts = await client.query<{ head_sha: string; part_key: string }>(
        "select head_sha, part_key from generation_part order by head_sha, part_key",
      );
      expect(parts.rows).toEqual([
        { head_sha: "new", part_key: "grouping" },
        { head_sha: "old", part_key: "detail:1" },
      ]);
    },
    MIGRATION_REPLAY_TIMEOUT_MS,
  );
});
