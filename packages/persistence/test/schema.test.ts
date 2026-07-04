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
} from "../src/schema/index.js";
import type { InstallationId, PullRequestRowId, RepoId, ReviewerId } from "../src/types.js";
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
} from "../src/types.js";

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
      state: PrState.open,
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
    decision: DispositionDecision.dismissed,
    reason: "false positive",
    decidedAt: new Date(),
  });

  await db.insert(generation).values({
    installationId: INSTALLATION,
    pullRequestId,
    kind: GenerationKind.brief,
    headSha: HEAD_SHA,
    baselineSha: null,
    status: GenerationStatus.succeeded,
  });

  await db.insert(auditLog).values({
    installationId: INSTALLATION,
    actorType: AuditActorType.app,
    action: AuditAction.generate,
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
] as const;

describe("M1 schema migrations", () => {
  it("creates all 11 M1 tables", async () => {
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
      actorType: AuditActorType.system,
      action: AuditAction.delete,
      targetType: "pull_request",
      targetId: 999_999_999n,
      metadata: { reason: "retention sweep" },
    });
    expect(await db.select({ id: auditLog.id }).from(auditLog)).toHaveLength(1);
  });
});
