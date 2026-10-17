// Schema tests: apply the checked-in migrations to a fresh PGlite instance
// and prove the table inventory, natural-key uniqueness, the erasure cascade
// (and its deliberate survivors), the brief_id cascade, and the no-FK audit
// ledger.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import {
  auditLog,
  authSession,
  brief,
  checkpoint,
  comparisonMarks,
  delta,
  disposition,
  generation,
  githubGrant,
  hunkSpan,
  pullRequest,
  reviewSession,
  revisionNarrative,
} from "../src/schema/index";
import type {
  InstallationId,
  PullRequestRowId,
  RepoId,
  ReviewerId,
} from "../src/types";
import {
  AuditOutcomes,
  AuditActorTypes,
  GenerationKinds,
  isInstallationId,
  isRepoId,
  isReviewerId,
} from "../src/types";
import { DispositionDecisions } from "types/dispositions";
import { GenerationStatuses } from "types/generations";
import { PrStates } from "types/pull-requests";
import { expectCheckViolation, freshPglite } from "./helpers";

/**
 * Drizzle wraps driver errors in DrizzleQueryError, so walk the `cause` chain
 * for the Postgres unique-violation message naming the constraint.
 */
function isUniqueViolationOf(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message.includes(`unique constraint "${constraint}"`)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/** Brand a bigint via its guard, the sanctioned no-`as` path. */
function brandWith<T extends bigint>(
  guard: (value: bigint) => value is T,
  value: bigint,
): T {
  if (!guard(value)) {
    throw new Error(`test fixture id failed its brand guard: ${value}`);
  }
  return value;
}

const INSTALLATION: InstallationId = brandWith(isInstallationId, 4242n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PREV_HEAD_SHA = "c".repeat(40);
const CHECKPOINT_SHA = "d".repeat(40);

type Db = ReturnType<typeof drizzle>;

async function freshDb(): Promise<Db> {
  return drizzle(await freshPglite());
}

async function insertPullRequest(db: Db): Promise<PullRequestRowId> {
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

interface ArtifactBody {
  readonly body: string;
  readonly byteSize: number;
}

function artifact(body: string): ArtifactBody {
  return { body, byteSize: Buffer.byteLength(body, "utf8") };
}

const ORIGIN = {
  provider: "anthropic",
  model: "claude-fable-5",
  effort: "high",
} as const;

/** Insert one row into every per-PR child table plus the non-PR tables. */
async function seedFullGraph(
  db: Db,
  pullRequestId: PullRequestRowId,
): Promise<void> {
  const briefRows = await db
    .insert(brief)
    .values({
      installationId: INSTALLATION,
      pullRequestId,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headIndex: 1,
      commitCount: 3,
      ...ORIGIN,
      ...artifact('{"brief":true}'),
      usedGroupIds: [],
    })
    .returning({ id: brief.id });
  const briefRow = briefRows[0];
  if (briefRow === undefined) {
    throw new Error("brief insert returned no row");
  }

  await db.insert(delta).values({
    installationId: INSTALLATION,
    pullRequestId,
    baselineSha: CHECKPOINT_SHA,
    headSha: HEAD_SHA,
    ...ORIGIN,
    ...artifact('{"delta":true}'),
  });

  await db.insert(revisionNarrative).values({
    installationId: INSTALLATION,
    pullRequestId,
    briefId: briefRow.id,
    prevHeadSha: PREV_HEAD_SHA,
    headSha: HEAD_SHA,
    ...ORIGIN,
    ...artifact('{"narrative":true}'),
  });

  await db.insert(comparisonMarks).values({
    installationId: INSTALLATION,
    pullRequestId,
    baselineSha: PREV_HEAD_SHA,
    headSha: HEAD_SHA,
    ...artifact('{"files":[]}'),
  });

  await db.insert(checkpoint).values({
    installationId: INSTALLATION,
    pullRequestId,
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    lastSubmittedSha: CHECKPOINT_SHA,
    submittedAt: new Date(),
  });

  const sessionRows = await db
    .insert(reviewSession)
    .values({
      installationId: INSTALLATION,
      briefId: briefRow.id,
      reviewerId: REVIEWER,
    })
    .returning({ id: reviewSession.id });
  const sessionRow = sessionRows[0];
  if (sessionRow === undefined) {
    throw new Error("review_session insert returned no row");
  }

  await db.insert(disposition).values({
    installationId: INSTALLATION,
    reviewSessionId: sessionRow.id,
    filePath: "src/index.ts",
    attribute: "sql-injection",
    regionStart: 10,
    regionEnd: 20,
    decision: DispositionDecisions.DISMISSED,
    reason: "false positive",
    decidedAt: new Date(),
  });

  await db.insert(hunkSpan).values({
    installationId: INSTALLATION,
    pullRequestId,
    baselineSha: PREV_HEAD_SHA,
    headSha: HEAD_SHA,
    spans: "[]",
  });

  await db.insert(generation).values({
    installationId: INSTALLATION,
    pullRequestId,
    kind: GenerationKinds.BRIEF,
    headSha: HEAD_SHA,
    baselineSha: null,
    status: GenerationStatuses.SUCCEEDED,
  });

  await db.insert(auditLog).values({
    installationId: INSTALLATION,
    actorType: AuditActorTypes.APP,
    operation: "generate",
    outcome: AuditOutcomes.OK,
    targetType: "pull_request",
    targetId: pullRequestId,
    metadata: { kind: "brief" },
  });

  const grants = await db
    .insert(githubGrant)
    .values({
      ghTokenCiphertext: "ciphertext",
      ghRefreshTokenCiphertext: "refresh-ciphertext",
      keyRef: "env:SESSION_KEY_V1",
      refreshExpiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: githubGrant.id });
  const grant = grants[0];
  if (grant === undefined) {
    throw new Error("grant insert returned no row");
  }
  await db.insert(authSession).values({
    sessionTokenHash: "sha256:deadbeef",
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}

const M1_TABLES = [
  "api_token",
  "audit_log",
  "auth_session",
  "brief",
  "checkpoint",
  "comparison_marks",
  "delta",
  "disposition",
  "generation",
  "generation_attempt",
  "github_grant",
  "hunk_span",
  "inbox_archive",
  "instance_version",
  "pull_request",
  "review_draft_comment",
  "review_group_reclassification",
  "review_read_mark",
  "review_session",
  "review_submitted_review",
  "revision_narrative",
  "user_settings",
] as const;

describe("M1 schema migrations", () => {
  it("creates all M1 tables", async () => {
    const db = await freshDb();
    const result = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = result.rows
      .map((row) => row["table_name"])
      .filter((name): name is string => typeof name === "string");
    // Equality, not containment: a rename that created the new table without
    // dropping the old one would pass a per-name check.
    expect(names).toEqual([...M1_TABLES]);
  });

  it("creates the partial closed_at sweep index and no purge_after column", async () => {
    const db = await freshDb();
    const result = await db.execute(
      sql`select indexdef from pg_indexes where indexname = 'pull_request_closed_at_idx'`,
    );
    const indexdef = result.rows[0]?.["indexdef"];
    expect(indexdef).toBe(
      "CREATE INDEX pull_request_closed_at_idx ON public.pull_request USING btree (closed_at) WHERE (closed_at IS NOT NULL)",
    );

    const stale = await db.execute(
      sql`select indexname from pg_indexes where indexname = 'pull_request_purge_after_idx'`,
    );
    expect(stale.rows).toHaveLength(0);
    const columns = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'pull_request' and column_name = 'purge_after'`,
    );
    expect(columns.rows).toHaveLength(0);
  });

  it.each([
    ["audit_log_occurred_at_idx", "audit_log", "occurred_at"],
    ["auth_session_expires_at_idx", "auth_session", "expires_at"],
  ])("creates the %s sweep index", async (indexName, table, column) => {
    const db = await freshDb();
    const result = await db.execute(
      sql`select indexdef from pg_indexes where indexname = ${indexName}`,
    );
    const indexdef = result.rows[0]?.["indexdef"];

    expect(indexdef).toBe(
      `CREATE INDEX ${indexName} ON public.${table} USING btree (${column})`,
    );
  });

  it("rejects two briefs with the same natural key", async () => {
    const db = await freshDb();
    const pullRequestId = await insertPullRequest(db);
    const values = {
      installationId: INSTALLATION,
      pullRequestId,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headIndex: 1,
      commitCount: 3,
      ...ORIGIN,
      ...artifact('{"brief":true}'),
      usedGroupIds: [],
    };
    await db.insert(brief).values(values);
    const rejection: unknown = await db
      .insert(brief)
      .values(values)
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(rejection).not.toBeNull();
    expect(isUniqueViolationOf(rejection, "brief_natural_key")).toBe(true);
  });

  it("a pull_request delete spares audit_log and auth_session", async () => {
    const db = await freshDb();
    const pullRequestId = await insertPullRequest(db);
    await seedFullGraph(db, pullRequestId);

    await db.delete(pullRequest).where(eq(pullRequest.id, pullRequestId));

    expect(await db.select({ id: brief.id }).from(brief)).toHaveLength(0);
    expect(await db.select({ id: delta.id }).from(delta)).toHaveLength(0);
    expect(
      await db.select({ id: revisionNarrative.id }).from(revisionNarrative),
    ).toHaveLength(0);
    expect(
      await db.select({ id: comparisonMarks.id }).from(comparisonMarks),
    ).toHaveLength(0);
    expect(await db.select({ id: hunkSpan.id }).from(hunkSpan)).toHaveLength(0);
    expect(
      await db.select({ id: checkpoint.id }).from(checkpoint),
    ).toHaveLength(0);
    expect(
      await db.select({ id: disposition.id }).from(disposition),
    ).toHaveLength(0);
    expect(
      await db.select({ id: generation.id }).from(generation),
    ).toHaveLength(0);

    // Deliberate survivors: the audit ledger (no FKs) and the
    // per-(installation, reviewer) session (not FK'd to pull_request).
    expect(await db.select({ id: auditLog.id }).from(auditLog)).toHaveLength(1);
    expect(
      await db.select({ id: authSession.id }).from(authSession),
    ).toHaveLength(1);
  });

  it("a brief delete cascades to revision_narrative only", async () => {
    const db = await freshDb();
    const pullRequestId = await insertPullRequest(db);
    await seedFullGraph(db, pullRequestId);

    const briefRows = await db.select({ id: brief.id }).from(brief);
    const briefRow = briefRows[0];
    if (briefRow === undefined) {
      throw new Error("expected a seeded brief row");
    }
    await db.delete(brief).where(eq(brief.id, briefRow.id));

    expect(
      await db.select({ id: revisionNarrative.id }).from(revisionNarrative),
    ).toHaveLength(0);
    expect(
      await db.select({ id: pullRequest.id }).from(pullRequest),
    ).toHaveLength(1);
    // Sibling artifacts are untouched by a brief regeneration.
    expect(await db.select({ id: delta.id }).from(delta)).toHaveLength(1);
  });

  it("accepts an audit_log row whose target row does not exist", async () => {
    const db = await freshDb();
    await db.insert(auditLog).values({
      installationId: INSTALLATION,
      actorType: AuditActorTypes.SYSTEM,
      operation: "delete",
      outcome: AuditOutcomes.OK,
      targetType: "pull_request",
      targetId: 999_999_999n,
      metadata: { reason: "retention sweep" },
    });
    expect(await db.select({ id: auditLog.id }).from(auditLog)).toHaveLength(1);
  });
  it("no credential row carries an installation column", async () => {
    const db = await freshDb();
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
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into pull_request (installation_id, repo_id, pr_number, state) values (1000, 777, 1, 'reopened')`,
      ),
      "pull_request_state_check",
    );
  });

  it("rejects an open pull_request that carries a close time", async () => {
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into pull_request (installation_id, repo_id, pr_number, state, closed_at) values (1000, 777, 1, 'open', now())`,
      ),
      "pull_request_open_retention_shape",
    );
  });

  it("rejects a generation row whose kind/baseline shape is invalid", async () => {
    const db = await freshDb();
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
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into audit_log (installation_id, actor_type, operation, outcome, target_type) values (1000, 'system', 'delete', 'ok', 'repos/acme/widgets')`,
      ),
      "audit_log_target_type_shape",
    );
  });

  it("rejects out-of-vocabulary generation.status and audit_log.outcome", async () => {
    const db = await freshDb();
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

  it("accepts an audit_log operation token and its outcome vocabulary", async () => {
    const db = await freshDb();
    await db.execute(
      sql`insert into audit_log (installation_id, actor_type, operation, outcome) values (1000, 'reviewer', 'submit-review', 'ok')`,
    );
    const rows = await db
      .select({ operation: auditLog.operation, outcome: auditLog.outcome })
      .from(auditLog);
    expect(rows[0]?.operation).toBe("submit-review");
    expect(rows[0]?.outcome).toBe(AuditOutcomes.OK);
  });

  it("rejects an audit_log operation that is not a kebab-case token", async () => {
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into audit_log (installation_id, actor_type, operation, outcome) values (1000, 'reviewer', 'repos/acme/widgets', 'ok')`,
      ),
      "audit_log_operation_shape",
    );
  });

  it("rejects an audit_log caller_ip that is not an address", async () => {
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into audit_log (installation_id, actor_type, operation, outcome, caller_ip) values (1000, 'reviewer', 'mark-ready', 'ok', 'user@example.com')`,
      ),
      "audit_log_caller_ip_shape",
    );
  });

  it("accepts generation.status 'superseded' after the 0003 vocab swap", async () => {
    const db = await freshDb();
    const prId = await insertPullRequest(db);
    // In-vocab: the migration-0003 CHECK swap admits it.
    await db.execute(
      sql`insert into generation (installation_id, pull_request_id, kind, head_sha, status) values (1000, ${prId}, 'brief', 'head', 'superseded')`,
    );
    const rows = await db
      .select({ status: generation.status })
      .from(generation);
    expect(rows[0]?.status).toBe(GenerationStatuses.SUPERSEDED);
  });
});

describe("schema additions from migration 0003", () => {
  it("pull_request.entry_comment_id is selectable and defaults to null", async () => {
    const db = await freshDb();
    const prId = await insertPullRequest(db);
    const rows = await db
      .select({ entryCommentId: pullRequest.entryCommentId })
      .from(pullRequest)
      .where(eq(pullRequest.id, prId));
    expect(rows[0]).toBeDefined();
    expect(rows[0]?.entryCommentId).toBeNull();
  });

  it("rejects an auth_session insert omitting grant_id", async () => {
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into auth_session (session_token_hash, reviewer_id, expires_at) values ('h', 31337, now())`,
      ),
      "grant_id",
    );
  });

  it("rejects a github_grant insert omitting the refresh-token ciphertext", async () => {
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into github_grant (gh_token_ciphertext, key_ref, refresh_expires_at) values ('ct', 'env:K', now())`,
      ),
      "gh_refresh_token_ciphertext",
    );
  });
});
