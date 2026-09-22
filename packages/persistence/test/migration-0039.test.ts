// Migration 0039 data test, same posture as migration-0036.test.ts: the
// rewrite must run against PRE-migration rows, which the shared harness (all
// migrations upfront, empty DB) cannot express. Applies 0000 to 0038 raw,
// seeds one row per world in both tables, applies 0039, and reads them back.
import { describe, expect, it } from "vitest";
import { PullRequestSources } from "../src/types";
import { applyMigrationFile, pgliteBefore, readCheckValues } from "./helpers";

describe("migration 0039 source values", () => {
  it("rewrites both tables' rows and pins both CHECKs to the map", async () => {
    const { client, target } = await pgliteBefore("0039_");

    await client.exec(`
      insert into pull_request (installation_id, owner_user_id, source, repo_id, pr_number, state)
      values (4242, null, 'app-installation', 99, 7, 'open'),
             (null, 501, 'url-box', 99, 8, 'open');
      insert into audit_log (installation_id, source, actor_type, operation, outcome, target_type, target_id)
      values (4242, 'app-installation', 'app', 'delete', 'ok', 'repo', 99),
             (null, 'url-box', 'app', 'delete', 'ok', 'repo', 99);
    `);

    await applyMigrationFile(client, target);

    const prs = await client.query<{ pr_number: number; source: string }>(
      "select pr_number, source from pull_request order by pr_number",
    );
    expect(prs.rows).toEqual([
      { pr_number: 7, source: PullRequestSources.INSTALLATION },
      { pr_number: 8, source: PullRequestSources.URL },
    ]);
    const audits = await client.query<{ source: string }>(
      "select source from audit_log order by installation_id nulls last",
    );
    expect(audits.rows).toEqual([
      { source: PullRequestSources.INSTALLATION },
      { source: PullRequestSources.URL },
    ]);

    for (const name of ["pull_request_owner_shape", "audit_log_source_shape"]) {
      expect((await readCheckValues(client, name)).toSorted()).toEqual(
        Object.values(PullRequestSources).toSorted(),
      );
    }
  });
});
