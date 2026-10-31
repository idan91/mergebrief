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
