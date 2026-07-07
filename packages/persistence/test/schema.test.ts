// Stage 2 schema tests: apply the checked-in migrations to a fresh PGlite
// instance and prove the ADR 0018 decisions — table inventory, natural-key
// uniqueness, the D5 erasure cascade (and its deliberate survivors), the
// D12 brief_id cascade, and the D9 no-FK audit ledger.
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import {
  auditLog,
  brief,
  checkpoint,
  comparisonMarks,
  delta,
  diffSnapshot,
  disposition,
  generation,
  pullRequest,
  reviewerSession,
  revisionNarrative,
} from "../src/schema/index";
import type { InstallationId, PullRequestRowId, RepoId, ReviewerId } from "../src/types";
import {
  AuditAction,
  AuditActorType,
  DispositionDecision,
  GenerationKind,
  GenerationStatus,
  PrState,
  isInstallationId,
  isRepoId,
  isReviewerId,
} from "../src/types";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Drizzle wraps driver errors (DrizzleQueryError) — walk the `cause` chain
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

/** Brand a bigint via its guard — the sanctioned no-`as` path. */
function brandWith<T extends bigint>(guard: (value: bigint) => value is T, value: bigint): T {
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
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

async function insertPullRequest(db: Db): Promise<PullRequestRowId> {
  const rows = await db
    .insert(pullRequest)
    .values({
      installationId: INSTALLATION,
      repoId: REPO,
      prNumber: 7,
      repoSlug: "acme/widgets",
      state: PrState.OPEN,
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

const PROVENANCE = { provider: "anthropic", model: "claude-fable-5", effort: "high" } as const;

/** Insert one row into every per-PR child table plus the non-PR tables. */
async function seedFullGraph(db: Db, pullRequestId: PullRequestRowId): Promise<void> {
  const briefRows = await db
    .insert(brief)
    .values({
      installationId: INSTALLATION,
      pullRequestId,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headIndex: 1,
      commitCount: 3,
      ...PROVENANCE,
      ...artifact('{"brief":true}'),
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
    ...PROVENANCE,
    ...artifact('{"delta":true}'),
  });

  await db.insert(diffSnapshot).values({
    installationId: INSTALLATION,
    pullRequestId,
    sha: CHECKPOINT_SHA,
    ...artifact("diff --git a/x b/x"),
  });

  await db.insert(revisionNarrative).values({
    installationId: INSTALLATION,
    pullRequestId,
    briefId: briefRow.id,
    prevHeadSha: PREV_HEAD_SHA,
    headSha: HEAD_SHA,
    ...PROVENANCE,
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

  await db.insert(disposition).values({
    installationId: INSTALLATION,
    pullRequestId,
    reviewerId: REVIEWER,
    filePath: "src/index.ts",
    attribute: "sql-injection",
    regionStart: 10,
    regionEnd: 20,
    decidedAtSha: HEAD_SHA,
    decision: DispositionDecision.DISMISSED,
    reason: "false positive",
    decidedAt: new Date(),
  });

  await db.insert(generation).values({
    installationId: INSTALLATION,
    pullRequestId,
    kind: GenerationKind.BRIEF,
    headSha: HEAD_SHA,
    baselineSha: null,
    status: GenerationStatus.SUCCEEDED,
  });

  await db.insert(auditLog).values({
    installationId: INSTALLATION,
    actorType: AuditActorType.APP,
    action: AuditAction.GENERATE,
    targetType: "pull_request",
    targetId: pullRequestId,
    metadata: { kind: "brief" },
  });

  await db.insert(reviewerSession).values({
    installationId: INSTALLATION,
    sessionTokenHash: "sha256:deadbeef",
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    ghTokenCiphertext: "ciphertext",
    ghRefreshTokenCiphertext: "refresh-ciphertext",
    keyRef: "env:SESSION_KEY_V1",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}

const M1_TABLES = [
  "audit_log",
  "brief",
  "checkpoint",
  "comparison_marks",
  "delta",
  "diff_snapshot",
  "disposition",
  "generation",
  "pull_request",
  "reviewer_session",
  "revision_narrative",
  "user_settings",
] as const;

describe("M1 schema migrations", () => {
  it("creates all 12 M1 tables", async () => {
    const db = await freshDb();
    const result = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = result.rows
      .map((row) => row["table_name"])
      .filter((name): name is string => typeof name === "string");
    for (const table of M1_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("creates the partial purge_after sweep index (raw-sql-hardening)", async () => {
    const db = await freshDb();
    const result = await db.execute(
      sql`select indexdef from pg_indexes where indexname = 'pull_request_purge_after_idx'`,
    );
    const row = result.rows[0];
    expect(row).toBeDefined();
    const indexdef = row?.["indexdef"];
    if (typeof indexdef !== "string") {
      throw new Error("indexdef missing");
    }
    expect(indexdef).toMatch(/WHERE \(?purge_after IS NOT NULL\)?/);
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
      ...PROVENANCE,
      ...artifact('{"brief":true}'),
    };
    await db.insert(brief).values(values);
    const rejection: unknown = await db.insert(brief).values(values).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
    expect(isUniqueViolationOf(rejection, "brief_natural_key")).toBe(true);
  });

  it("cascades a pull_request delete to every per-PR child but spares audit_log and reviewer_session", async () => {
    const db = await freshDb();
    const pullRequestId = await insertPullRequest(db);
    await seedFullGraph(db, pullRequestId);

    await db.delete(pullRequest).where(eq(pullRequest.id, pullRequestId));

    expect(await db.select({ id: brief.id }).from(brief)).toHaveLength(0);
    expect(await db.select({ id: delta.id }).from(delta)).toHaveLength(0);
    expect(await db.select({ id: diffSnapshot.id }).from(diffSnapshot)).toHaveLength(0);
    expect(await db.select({ id: revisionNarrative.id }).from(revisionNarrative)).toHaveLength(0);
    expect(await db.select({ id: comparisonMarks.id }).from(comparisonMarks)).toHaveLength(0);
    expect(await db.select({ id: checkpoint.id }).from(checkpoint)).toHaveLength(0);
    expect(await db.select({ id: disposition.id }).from(disposition)).toHaveLength(0);
    expect(await db.select({ id: generation.id }).from(generation)).toHaveLength(0);

    // Deliberate survivors: the audit ledger (D9, no FKs) and the
    // per-(installation, reviewer) session (D11, not FK'd to pull_request).
    expect(await db.select({ id: auditLog.id }).from(auditLog)).toHaveLength(1);
    expect(await db.select({ id: reviewerSession.id }).from(reviewerSession)).toHaveLength(1);
  });

  it("cascades a brief delete to its revision_narrative but not the pull_request", async () => {
    const db = await freshDb();
    const pullRequestId = await insertPullRequest(db);
    await seedFullGraph(db, pullRequestId);

    const briefRows = await db.select({ id: brief.id }).from(brief);
    const briefRow = briefRows[0];
    if (briefRow === undefined) {
      throw new Error("expected a seeded brief row");
    }
    await db.delete(brief).where(eq(brief.id, briefRow.id));

    expect(await db.select({ id: revisionNarrative.id }).from(revisionNarrative)).toHaveLength(0);
    expect(await db.select({ id: pullRequest.id }).from(pullRequest)).toHaveLength(1);
    // Sibling artifacts are untouched by a brief regeneration.
    expect(await db.select({ id: delta.id }).from(delta)).toHaveLength(1);
  });

  it("accepts an audit_log row whose target row does not exist (no outbound FKs)", async () => {
    const db = await freshDb();
    await db.insert(auditLog).values({
      installationId: INSTALLATION,
      actorType: AuditActorType.SYSTEM,
      action: AuditAction.DELETE,
      targetType: "pull_request",
      targetId: 999_999_999n,
      metadata: { reason: "retention sweep" },
    });
    expect(await db.select({ id: auditLog.id }).from(auditLog)).toHaveLength(1);
  });
});

/** Walk the `cause` chain for a Postgres error naming the given constraint. */
async function expectCheckViolation(run: Promise<unknown>, constraint: string): Promise<void> {
  let thrown: unknown;
  try {
    await run;
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected a rejection naming ${constraint}`).toBeDefined();
  let current: unknown = thrown;
  let found = false;
  while (current instanceof Error) {
    if (current.message.includes(constraint)) {
      found = true;
      break;
    }
    current = current.cause;
  }
  expect(found, `no error in the cause chain names ${constraint}`).toBe(true);
}

describe("closed-vocabulary + shape CHECK constraints (PR #23 review)", () => {
  it("rejects an out-of-vocabulary pull_request.state at the DB", async () => {
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into pull_request (installation_id, repo_id, pr_number, state) values (1000, 777, 1, 'reopened')`,
      ),
      "pull_request_state_check",
    );
  });

  it("rejects an open pull_request armed for the sweep (lifecycle shape)", async () => {
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into pull_request (installation_id, repo_id, pr_number, state, purge_after) values (1000, 777, 1, 'open', now())`,
      ),
      "pull_request_open_retention_shape",
    );
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
        sql`insert into generation (installation_id, pull_request_id, kind, head_sha, status) values (1000, ${prId}, 'delta', 'head', 'queued')`,
      ),
      "generation_kind_baseline_shape",
    );
    // brief WITH a baseline: forbidden.
    await expectCheckViolation(
      db.execute(
        sql`insert into generation (installation_id, pull_request_id, kind, head_sha, baseline_sha, status) values (1000, ${prId}, 'brief', 'head', 'chk', 'queued')`,
      ),
      "generation_kind_baseline_shape",
    );
    // revision-narrative WITH its prevHead baseline: allowed.
    await db.execute(
      sql`insert into generation (installation_id, pull_request_id, kind, head_sha, baseline_sha, status) values (1000, ${prId}, 'revision-narrative', 'head', 'prev', 'queued')`,
    );
  });

  it("rejects a route/slug-shaped audit_log.target_type at the DB", async () => {
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into audit_log (installation_id, actor_type, action, target_type) values (1000, 'system', 'delete', 'repos/acme/widgets')`,
      ),
      "audit_log_target_type_shape",
    );
  });

  it("rejects out-of-vocabulary generation.status and audit_log.action", async () => {
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
        sql`insert into audit_log (installation_id, actor_type, action) values (1000, 'system', 'view')`,
      ),
      "audit_log_action_check",
    );
  });

  it("accepts audit_log.action 'submit' after the 0007 vocab swap (BRIEF-23)", async () => {
    const db = await freshDb();
    await db.execute(
      sql`insert into audit_log (installation_id, actor_type, action) values (1000, 'reviewer', 'submit')`,
    );
    const rows = await db.select({ action: auditLog.action }).from(auditLog);
    expect(rows[0]?.action).toBe(AuditAction.SUBMIT);
  });

  it("accepts generation.status 'superseded' after the 0003 vocab swap", async () => {
    const db = await freshDb();
    const prId = await insertPullRequest(db);
    // In-vocab (BRIEF-2) — the migration-0003 CHECK swap admits it.
    await db.execute(
      sql`insert into generation (installation_id, pull_request_id, kind, head_sha, status) values (1000, ${prId}, 'brief', 'head', 'superseded')`,
    );
    const rows = await db.select({ status: generation.status }).from(generation);
    expect(rows[0]?.status).toBe(GenerationStatus.SUPERSEDED);
  });
});

describe("BRIEF-2 schema additions (migration 0003)", () => {
  it("pull_request.entry_comment_id is selectable and defaults to null (no writer)", async () => {
    const db = await freshDb();
    const prId = await insertPullRequest(db);
    const rows = await db
      .select({ entryCommentId: pullRequest.entryCommentId })
      .from(pullRequest)
      .where(eq(pullRequest.id, prId));
    expect(rows[0]).toBeDefined();
    expect(rows[0]?.entryCommentId).toBeNull();
  });

  it("rejects a reviewer_session insert omitting gh_refresh_token_ciphertext (NOT NULL)", async () => {
    const db = await freshDb();
    await expectCheckViolation(
      db.execute(
        sql`insert into reviewer_session (installation_id, session_token_hash, reviewer_id, gh_token_ciphertext, key_ref, expires_at) values (1000, 'h', 31337, 'ct', 'env:K', now())`,
      ),
      "gh_refresh_token_ciphertext",
    );
  });
});
