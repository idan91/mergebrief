// Schema tests: apply the checked-in migrations to a fresh PGlite instance
// and prove the foreign-key indexes, the credential tables' lack of an
// installation column, and the closed-vocabulary and shape CHECKs.
import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { pullRequest } from "../src/schema/index";
import type { InstallationId, PullRequestRowId, RepoId } from "../src/types";
import { isInstallationId, isRepoId } from "../src/types";
import { PrStates } from "types/pull-requests";
import {
  brandWith,
  expectCheckViolation,
  registerSharedPglite,
} from "./helpers";

const shared = registerSharedPglite();

const INSTALLATION: InstallationId = brandWith(isInstallationId, 4242n);
const REPO: RepoId = brandWith(isRepoId, 777n);

async function insertPullRequest(
  db: PgliteDatabase,
): Promise<PullRequestRowId> {
  const rows = await db
    .insert(pullRequest)
    .values({
      installationId: INSTALLATION,
      repoId: REPO,
      prNumber: 7,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
    })
    .returning({ id: pullRequest.id });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("pull_request insert returned no row");
  }
  return row.id;
}

describe("M1 schema migrations", () => {
  it("leads an index with every foreign key column", async () => {
    const db = shared.db;
    const unindexed = await db.execute(sql`
      select c.conrelid::regclass::text as child, a.attname as foreign_key
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
        )
    `);

    expect(unindexed.rows).toEqual([]);
  });

  it("no credential row carries an installation column", async () => {
    const db = shared.db;
    const rows = await db.execute(sql`
      select table_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('auth_session', 'api_token', 'user_settings')
        and column_name in ('installation_id', 'default_installation_id')
    `);
    expect(rows.rows).toEqual([]);
  });
});

describe("closed-vocabulary + shape CHECK constraints", () => {
  it("rejects an out-of-vocabulary pull_request.state at the DB", async () => {
    const db = shared.db;
    await expectCheckViolation(
      db.execute(
        sql`insert into pull_request (installation_id, repo_id, pr_number, state) values (1000, 777, 1, 'reopened')`,
      ),
      "pull_request_state_check",
    );
  });

  it("rejects an open pull_request that carries a close time", async () => {
    const db = shared.db;
    await expectCheckViolation(
      db.execute(
        sql`insert into pull_request (installation_id, repo_id, pr_number, state, closed_at) values (1000, 777, 1, 'open', now())`,
      ),
      "pull_request_open_retention_shape",
    );
  });

  it("rejects a generation row whose kind/baseline shape is invalid", async () => {
    const db = shared.db;
    const prId = await insertPullRequest(db);
    // delta without a baseline: forbidden.
    await expectCheckViolation(
      db.execute(
        sql`insert into generation (installation_id, pull_request_id, kind, head_sha, status) values (1000, ${prId}, 'delta', 'head', 'pending')`,
      ),
      "generation_kind_baseline_shape",
    );
    // brief WITH a baseline: forbidden.
    await expectCheckViolation(
      db.execute(
        sql`insert into generation (installation_id, pull_request_id, kind, head_sha, baseline_sha, status) values (1000, ${prId}, 'brief', 'head', 'chk', 'pending')`,
      ),
      "generation_kind_baseline_shape",
    );
    // revision-narrative WITH its prevHead baseline: allowed.
    await db.execute(
      sql`insert into generation (installation_id, pull_request_id, kind, head_sha, baseline_sha, status) values (1000, ${prId}, 'revision-narrative', 'head', 'prev', 'pending')`,
    );
  });

  it("rejects a route/slug-shaped audit_log.target_type at the DB", async () => {
    const db = shared.db;
    await expectCheckViolation(
      db.execute(
        sql`insert into audit_log (installation_id, actor_type, operation, outcome, target_type) values (1000, 'system', 'delete', 'ok', 'repos/acme/widgets')`,
      ),
      "audit_log_target_type_shape",
    );
  });

  it("rejects out-of-vocabulary generation.status and audit_log.outcome", async () => {
    const db = shared.db;
    const prId = await insertPullRequest(db);
    await expectCheckViolation(
      db.execute(
        sql`insert into generation (installation_id, pull_request_id, kind, head_sha, status) values (1000, ${prId}, 'brief', 'head', 'cancelled')`,
      ),
      "generation_status_check",
    );
    await expectCheckViolation(
      db.execute(
        sql`insert into audit_log (installation_id, actor_type, operation, outcome) values (1000, 'system', 'read-brief', 'viewed')`,
      ),
      "audit_log_outcome_check",
    );
  });

  it("rejects an audit_log operation that is not a kebab-case token", async () => {
    const db = shared.db;
    await expectCheckViolation(
      db.execute(
        sql`insert into audit_log (installation_id, actor_type, operation, outcome) values (1000, 'reviewer', 'repos/acme/widgets', 'ok')`,
      ),
      "audit_log_operation_shape",
    );
  });
});

describe("schema additions from migration 0003", () => {
  it("rejects an auth_session insert omitting grant_id", async () => {
    const db = shared.db;
    await expectCheckViolation(
      db.execute(
        sql`insert into auth_session (session_token_hash, reviewer_id, expires_at) values ('h', 31337, now())`,
      ),
      "grant_id",
    );
  });

  it("rejects a github_grant insert omitting the refresh-token ciphertext", async () => {
    const db = shared.db;
    await expectCheckViolation(
      db.execute(
        sql`insert into github_grant (user_id, gh_token_ciphertext, key_ref, refresh_expires_at) values (777, 'ct', 'env:K', now())`,
      ),
      "gh_refresh_token_ciphertext",
    );
  });
});
