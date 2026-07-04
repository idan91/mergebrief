// Stage 5 purge + retention tests (PGlite). Prove the D5/D9/D11 deletion seam:
// a PR purge cascades all 8 child tables while sparing the no-FK audit ledger
// (an appended `delete` row proves survival) and the non-PR reviewer_session;
// cross-tenant purge is a Result `notFound` with nothing deleted;
// installation purge is tenant-isolated with audit_log retained; the retention
// sweep removes only expired, non-null, in-tenant rows; `setRetention(null)`
// makes a PR unsweepable; and the session TTL sweep respects the tenant and
// emits NO audit entry.
//
// Seeds via a RAW drizzle handle (so tables with no store — e.g. disposition —
// can be populated) over the SAME PGlite the ctx-bound `purgeRoutines` runs on
// (`fromDrizzle` wraps it as the opaque handle).
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { type AppDatabase, fromDrizzle } from "../src/db";
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
import * as schema from "../src/schema/index";
import { PurgeErrorCode, purgeRoutines } from "../src/purge";
import type { TenantContext } from "../src/tenant";
import {
  AuditAction,
  DispositionDecision,
  GenerationKind,
  GenerationStatus,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { brandWith } from "./helpers";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

type Db = ReturnType<typeof drizzle<typeof schema>>;

interface Pair {
  readonly raw: Db;
  readonly handle: AppDatabase;
}

async function freshPair(): Promise<Pair> {
  const client = new PGlite();
  const raw = drizzle(client, { schema });
  await migrate(raw, { migrationsFolder: MIGRATIONS_FOLDER });
  return { raw, handle: fromDrizzle(raw) };
}

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const REPO_OTHER: RepoId = brandWith(isRepoId, 888n);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);
const CTX_A: TenantContext = { installationId: TENANT_A };

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PREV_HEAD_SHA = "c".repeat(40);
const CHECKPOINT_SHA = "d".repeat(40);
const PROVENANCE = { provider: "anthropic", model: "claude-fable-5", effort: "high" } as const;

function artifact(body: string): { readonly body: string; readonly byteSize: number } {
  return { body, byteSize: Buffer.byteLength(body, "utf8") };
}

/** Ascending bigint comparator — `Array#sort`'s default coerces to string. */
function bigIntAsc(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface PrSeed {
  readonly installationId: InstallationId;
  readonly repoId?: RepoId;
  readonly prNumber?: number;
  readonly state?: PrState;
  readonly closedAt?: Date;
  readonly purgeAfter?: Date;
}

async function insertPr(db: Db, seed: PrSeed): Promise<PullRequestRowId> {
  const rows = await db
    .insert(pullRequest)
    .values({
      installationId: seed.installationId,
      repoId: seed.repoId ?? REPO,
      prNumber: seed.prNumber ?? 7,
      repoSlug: "acme/widgets",
      state: seed.state ?? PrState.OPEN,
      closedAt: seed.closedAt,
      purgeAfter: seed.purgeAfter,
    })
    .returning({ id: pullRequest.id });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("pull_request insert returned no row");
  }
  return row.id;
}

/** One row in every per-PR child table + the two non-PR tables, for a tenant. */
async function seedFullGraph(
  db: Db,
  installationId: InstallationId,
  pullRequestId: PullRequestRowId,
): Promise<void> {
  const briefRows = await db
    .insert(brief)
    .values({
      installationId,
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
    installationId,
    pullRequestId,
    baselineSha: CHECKPOINT_SHA,
    headSha: HEAD_SHA,
    ...PROVENANCE,
    ...artifact('{"delta":true}'),
  });
  await db.insert(diffSnapshot).values({
    installationId,
    pullRequestId,
    sha: CHECKPOINT_SHA,
    ...artifact("diff --git a/x b/x"),
  });
  await db.insert(revisionNarrative).values({
    installationId,
    pullRequestId,
    briefId: briefRow.id,
    prevHeadSha: PREV_HEAD_SHA,
    headSha: HEAD_SHA,
    ...PROVENANCE,
    ...artifact('{"narrative":true}'),
  });
  await db.insert(comparisonMarks).values({
    installationId,
    pullRequestId,
    baselineSha: PREV_HEAD_SHA,
    headSha: HEAD_SHA,
    ...artifact('{"files":[]}'),
  });
  await db.insert(checkpoint).values({
    installationId,
    pullRequestId,
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    lastSubmittedSha: CHECKPOINT_SHA,
    submittedAt: new Date(),
  });
  await db.insert(disposition).values({
    installationId,
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
    installationId,
    pullRequestId,
    kind: GenerationKind.BRIEF,
    headSha: HEAD_SHA,
    baselineSha: null,
    status: GenerationStatus.SUCCEEDED,
  });
  // A pre-existing (non-delete) audit row — proves audit_log is retained.
  await db.insert(auditLog).values({
    installationId,
    actorType: "app",
    action: AuditAction.GENERATE,
    targetType: "pull_request",
    targetId: pullRequestId,
    metadata: { kind: "brief" },
  });
  // The one non-PR table (D11) — must survive a PR-scoped purge.
  await db.insert(reviewerSession).values({
    installationId,
    sessionTokenHash: `sha256:${installationId}:${pullRequestId}`,
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    ghTokenCiphertext: "ciphertext",
    keyRef: "env:SESSION_KEY_V1",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}

async function countChildTables(db: Db, pullRequestId: PullRequestRowId): Promise<number> {
  const tables = [brief, delta, diffSnapshot, revisionNarrative, comparisonMarks];
  let total = 0;
  for (const table of tables) {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.pullRequestId, pullRequestId));
    total += rows.length;
  }
  for (const table of [checkpoint, disposition, generation]) {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.pullRequestId, pullRequestId));
    total += rows.length;
  }
  return total;
}

async function deleteAudits(db: Db, installationId: InstallationId) {
  return db
    .select({ id: auditLog.id, targetType: auditLog.targetType, targetId: auditLog.targetId })
    .from(auditLog)
    .where(and(eq(auditLog.installationId, installationId), eq(auditLog.action, AuditAction.DELETE)));
}

describe("purgeRoutines.purgePullRequest — cascade + no-FK audit survival (D5/D9)", () => {
  let pair: Pair;
  let prId: PullRequestRowId;

  beforeEach(async () => {
    pair = await freshPair();
    prId = await insertPr(pair.raw, { installationId: TENANT_A });
    await seedFullGraph(pair.raw, TENANT_A, prId);
  });

  it("erases all 8 child tables, spares audit_log + reviewer_session, appends a delete row", async () => {
    expect(await countChildTables(pair.raw, prId)).toBe(8);

    const result = await purgeRoutines(pair.handle, CTX_A).purgePullRequest(prId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected purge success");
    expect(result.value).toBe(1);

    // Every per-PR child gone by FK cascade.
    expect(await countChildTables(pair.raw, prId)).toBe(0);
    expect(await pair.raw.select({ id: pullRequest.id }).from(pullRequest)).toHaveLength(0);

    // Survivors: the non-PR session (D11) and the whole audit ledger (D9).
    expect(await pair.raw.select({ id: reviewerSession.id }).from(reviewerSession)).toHaveLength(1);

    // The appended `delete` row EXISTS after the purge — proving audit_log has
    // no FK to the row it records (it outlives the cascade).
    const deletes = await deleteAudits(pair.raw, TENANT_A);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.targetType).toBe("pull_request");
    expect(deletes[0]?.targetId).toBe(prId);
    // The pre-existing `generate` row is also retained (2 audit rows total).
    expect(await pair.raw.select({ id: auditLog.id }).from(auditLog)).toHaveLength(2);
  });

  it("rejects a cross-tenant PR with notFound and deletes nothing", async () => {
    // Tenant B calls purge on tenant A's PR.
    const result = await purgeRoutines(pair.handle, { installationId: TENANT_B }).purgePullRequest(
      prId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected notFound");
    expect(result.error.code).toBe(PurgeErrorCode.NOT_FOUND);

    // Nothing deleted, and no spurious audit entry under either tenant.
    expect(await countChildTables(pair.raw, prId)).toBe(8);
    expect(await pair.raw.select({ id: pullRequest.id }).from(pullRequest)).toHaveLength(1);
    expect(await deleteAudits(pair.raw, TENANT_A)).toHaveLength(0);
    expect(await deleteAudits(pair.raw, TENANT_B)).toHaveLength(0);
  });
});

describe("purgeRoutines.purgeRepo — scoped predicate-delete (D5)", () => {
  it("purges only the named repo's PRs and returns the count", async () => {
    const { raw, handle } = await freshPair();
    const pr1 = await insertPr(raw, { installationId: TENANT_A, repoId: REPO, prNumber: 1 });
    const pr2 = await insertPr(raw, { installationId: TENANT_A, repoId: REPO, prNumber: 2 });
    const other = await insertPr(raw, {
      installationId: TENANT_A,
      repoId: REPO_OTHER,
      prNumber: 3,
    });
    await seedFullGraph(raw, TENANT_A, pr1);

    const count = await purgeRoutines(handle, CTX_A).purgeRepo(REPO);
    expect(count).toBe(2);

    const remaining = await raw.select({ id: pullRequest.id }).from(pullRequest);
    expect(remaining.map((r) => r.id)).toEqual([other]);
    // pr1's children cascaded away.
    expect(await countChildTables(raw, pr1)).toBe(0);
    void pr2;

    const deletes = await deleteAudits(raw, TENANT_A);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.targetType).toBe("repo");
  });
});

describe("purgeRoutines.purgeInstallation — tenant-isolated offboarding (D5/D11)", () => {
  it("removes tenant A's PRs + sessions only; B untouched; audit_log retained", async () => {
    const { raw, handle } = await freshPair();
    const aPr = await insertPr(raw, { installationId: TENANT_A, prNumber: 1 });
    const bPr = await insertPr(raw, { installationId: TENANT_B, prNumber: 1 });
    await seedFullGraph(raw, TENANT_A, aPr);
    await seedFullGraph(raw, TENANT_B, bPr);

    const counts = await purgeRoutines(handle, CTX_A).purgeInstallation();
    expect(counts).toEqual({ pullRequests: 1, sessions: 1 });

    // Tenant A fully erased (PR + session).
    const prs = await raw.select({ id: pullRequest.id }).from(pullRequest);
    expect(prs.map((r) => r.id)).toEqual([bPr]);
    const sessions = await raw
      .select({ id: reviewerSession.id, installationId: reviewerSession.installationId })
      .from(reviewerSession);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.installationId).toBe(TENANT_B);

    // Tenant B's child graph is intact.
    expect(await countChildTables(raw, bPr)).toBe(8);

    // audit_log retained: both pre-existing generate rows + the new A delete.
    expect(await raw.select({ id: auditLog.id }).from(auditLog)).toHaveLength(3);
    const aDeletes = await deleteAudits(raw, TENANT_A);
    expect(aDeletes).toHaveLength(1);
    expect(aDeletes[0]?.targetType).toBe("installation");
    expect(aDeletes[0]?.targetId).toBe(TENANT_A);
    expect(await deleteAudits(raw, TENANT_B)).toHaveLength(0);
  });
});

describe("purgeRoutines.sweepExpired — retention sweep (D5)", () => {
  it("removes only expired, non-null, in-tenant rows and audits the count", async () => {
    const { raw, handle } = await freshPair();
    const now = new Date("2026-07-04T00:00:00Z");
    const past = new Date("2026-07-01T00:00:00Z");
    const future = new Date("2026-07-10T00:00:00Z");

    const expired = await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 1,
      purgeAfter: past,
    });
    const openNever = await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 2,
      // purge_after null — retention disabled / still open.
    });
    const notYet = await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 3,
      purgeAfter: future,
    });
    // Another tenant with an expired row — must be spared.
    const bExpired = await insertPr(raw, {
      installationId: TENANT_B,
      prNumber: 1,
      purgeAfter: past,
    });

    const purged = await purgeRoutines(handle, CTX_A).sweepExpired(now);
    expect(purged).toBe(1);

    const remaining = await raw.select({ id: pullRequest.id }).from(pullRequest);
    expect(remaining.map((r) => r.id).toSorted(bigIntAsc)).toEqual(
      [openNever, notYet, bExpired].toSorted(bigIntAsc),
    );
    void expired;

    const deletes = await deleteAudits(raw, TENANT_A);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.targetType).toBe("pull_request");
    // The count is summarized in metadata; targetId is absent for a batch.
    expect(deletes[0]?.targetId).toBeNull();
    // Tenant B untouched and unaudited.
    expect(await deleteAudits(raw, TENANT_B)).toHaveLength(0);
  });

  it("emits no audit entry when the sweep erases nothing (D9 low-volume rule)", async () => {
    const { raw, handle } = await freshPair();
    await insertPr(raw, { installationId: TENANT_A, prNumber: 1 }); // null purge_after
    const purged = await purgeRoutines(handle, CTX_A).sweepExpired(new Date());
    expect(purged).toBe(0);
    expect(await deleteAudits(raw, TENANT_A)).toHaveLength(0);
  });
});

describe("purgeRoutines.setRetention — purge_after semantics (D5)", () => {
  it("sets purge_after = closedAt + grace and stamps closed_at", async () => {
    const { raw, handle } = await freshPair();
    const prId = await insertPr(raw, { installationId: TENANT_A });
    const closedAt = new Date("2026-07-01T00:00:00Z");

    const result = await purgeRoutines(handle, CTX_A).setRetention(prId, closedAt, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.closedAt?.getTime()).toBe(closedAt.getTime());
    const expected = closedAt.getTime() + 7 * 24 * 60 * 60 * 1000;
    expect(result.value.purgeAfter?.getTime()).toBe(expected);
  });

  it("rejects negative and non-finite graceDays without writing", async () => {
    const { raw, handle } = await freshPair();
    const routines = purgeRoutines(handle, CTX_A);
    const prId = await insertPr(raw, { installationId: TENANT_A });
    const closedAt = new Date("2026-07-01T00:00:00Z");

    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await routines.setRetention(prId, closedAt, bad);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.error.code).toBe(PurgeErrorCode.INVALID_GRACE);
    }
    const rows = await raw.select().from(pullRequest).where(eq(pullRequest.id, prId));
    expect(rows[0]?.purgeAfter).toBeNull();
    expect(rows[0]?.closedAt).toBeNull();
  });

  it("null grace disables retention — the row is never swept", async () => {
    const { raw, handle } = await freshPair();
    const routines = purgeRoutines(handle, CTX_A);
    const prId = await insertPr(raw, { installationId: TENANT_A });

    const result = await routines.setRetention(prId, new Date("2026-07-01T00:00:00Z"), null);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.purgeAfter).toBeNull();

    // A sweep far in the future still cannot touch a null-purge_after row.
    const purged = await routines.sweepExpired(new Date("2099-01-01T00:00:00Z"));
    expect(purged).toBe(0);
    expect(await raw.select({ id: pullRequest.id }).from(pullRequest)).toHaveLength(1);
  });

  it("returns notFound for a PR outside the tenant", async () => {
    const { raw, handle } = await freshPair();
    const prId = await insertPr(raw, { installationId: TENANT_A });
    const result = await purgeRoutines(handle, { installationId: TENANT_B }).setRetention(
      prId,
      new Date(),
      3,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected notFound");
    expect(result.error.code).toBe(PurgeErrorCode.NOT_FOUND);
  });
});

describe("purgeRoutines.sweepExpiredSessions — TTL sweep (D11)", () => {
  it("removes only in-tenant expired sessions and emits no audit entry", async () => {
    const { raw, handle } = await freshPair();
    const now = new Date("2026-07-04T00:00:00Z");
    const expired = new Date("2026-07-01T00:00:00Z");
    const live = new Date("2026-07-10T00:00:00Z");

    async function session(
      installationId: InstallationId,
      token: string,
      expiresAt: Date,
    ): Promise<void> {
      await raw.insert(reviewerSession).values({
        installationId,
        sessionTokenHash: token,
        reviewerId: REVIEWER,
        ghTokenCiphertext: "ciphertext",
        keyRef: "env:SESSION_KEY_V1",
        expiresAt,
      });
    }
    await session(TENANT_A, "a-expired", expired);
    await session(TENANT_A, "a-live", live);
    await session(TENANT_B, "b-expired", expired);

    const deleted = await purgeRoutines(handle, CTX_A).sweepExpiredSessions(now);
    expect(deleted).toBe(1);

    const remaining = await raw
      .select({ token: reviewerSession.sessionTokenHash })
      .from(reviewerSession);
    expect(remaining.map((r) => r.token).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "a-live",
      "b-expired",
    ]);

    // No artifact-level audit for short-lived session churn (stated choice).
    expect(await deleteAudits(raw, TENANT_A)).toHaveLength(0);
  });
});
