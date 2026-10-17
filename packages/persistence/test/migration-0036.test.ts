// Migration 0036 data test, same posture as migration-0017.test.ts: the
// rewrite must run against PRE-migration rows, which the shared harness (all
// migrations upfront, empty DB) cannot express. Applies 0000 to 0035 raw,
// seeds a `queued` generation row, applies 0036, and reads it back.
import { describe, expect, it } from "vitest";
import { GenerationStatuses } from "types/generations";
import {
  applyMigrationFile,
  MIGRATION_REPLAY_TIMEOUT_MS,
  pgliteBefore,
  readCheckValues,
} from "./helpers";

describe(
  "migration 0036 generation pending",
  { timeout: MIGRATION_REPLAY_TIMEOUT_MS },
  () => {
    it("rewrites queued rows to pending and leaves terminal rows alone", async () => {
      const { client, target } = await pgliteBefore("0036_");

      await client.exec(`
      insert into pull_request (installation_id, repo_id, pr_number, repo_slug, state)
      values (4242, 99, 7, 'acme/widgets', 'open');
      insert into generation (installation_id, pull_request_id, kind, head_sha, status)
      select 4242, id, 'brief', 'head-waiting', 'queued' from pull_request where pr_number = 7;
      insert into generation (installation_id, pull_request_id, kind, head_sha, status)
      select 4242, id, 'brief', 'head-done', 'succeeded' from pull_request where pr_number = 7;
    `);

      await applyMigrationFile(client, target);

      const rows = await client.query<{ head_sha: string; status: string }>(
        "select head_sha, status from generation order by head_sha",
      );
      expect(rows.rows).toEqual([
        { head_sha: "head-done", status: "succeeded" },
        { head_sha: "head-waiting", status: "pending" },
      ]);

      expect(
        (await readCheckValues(client, "generation_status_check")).toSorted(),
      ).toEqual(Object.values(GenerationStatuses).toSorted());
    });
  },
);
