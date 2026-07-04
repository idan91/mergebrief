// Stage 3 tenant-repository tests. Prove the D2b invariant end to end on real
// Postgres semantics (PGlite): tenant A cannot read or attach to tenant B's
// rows, cross-tenant child writes are rejected WITHOUT a DB write, and the
// upsert paths are idempotent. Plus a type-level guard that the package's
// public surface never leaks a queryable database handle.
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createDb,
  forTenant,
  parseTenantContext,
  RepositoryErrorCode,
  safeParseTenantContext,
  type AppDatabase,
  type PullRequestLifecycle,
  type PullRequestRow,
  type PullRequestUpsertInput,
  type TenantContext,
  type TenantRepository,
} from "../src/lib";
import {
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  type InstallationId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { brandWith, freshDatabase } from "./helpers";

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);

const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };

function upsertInput(
  prNumber: number,
  lifecycle: PullRequestLifecycle = { state: PrState.OPEN },
): PullRequestUpsertInput {
  return { repoId: REPO, prNumber, repoSlug: "acme/widgets", ...lifecycle };
}

describe("forTenant — tenant isolation on reads", () => {
  it("A cannot read a pull_request written under B (same repo + number)", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const b = forTenant(handle, CTX_B);

    await b.pullRequests.upsert(upsertInput(7));

    // Same natural key apart from installation_id → invisible to A.
    expect(await a.pullRequests.getByNumber(REPO, 7)).toBeUndefined();
    // B still sees its own row.
    const bRow = await b.pullRequests.getByNumber(REPO, 7);
    expect(bRow?.installationId).toBe(TENANT_B);
  });

  it("A and B keep independent rows under the same natural key", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const b = forTenant(handle, CTX_B);

    await a.pullRequests.upsert(upsertInput(7, { state: PrState.OPEN }));
    await b.pullRequests.upsert(upsertInput(7, { state: PrState.MERGED, closedAt: new Date(), purgeAfter: null }));

    expect((await a.pullRequests.getByNumber(REPO, 7))?.state).toBe(PrState.OPEN);
    expect((await b.pullRequests.getByNumber(REPO, 7))?.state).toBe(PrState.MERGED);
  });

  it("A cannot read a checkpoint written under B", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const b = forTenant(handle, CTX_B);

    const bPr = await b.pullRequests.upsert(upsertInput(7));
    const submit = await b.checkpoints.upsertOnSubmit({
      pullRequestId: bPr.id,
      reviewerId: REVIEWER,
      lastSubmittedSha: "a".repeat(40),
      submittedAt: new Date(),
    });
    expect(submit.ok).toBe(true);

    expect(await a.checkpoints.get(bPr.id, REVIEWER)).toBeUndefined();
    expect(await b.checkpoints.get(bPr.id, REVIEWER)).toBeDefined();
  });
});

describe("forTenant — cross-tenant child writes are rejected without a DB write", () => {
  it("rejects a checkpoint whose pull_request belongs to another tenant", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const b = forTenant(handle, CTX_B);

    // Parent PR lives under B.
    const bPr = await b.pullRequests.upsert(upsertInput(7));

    // A tries to attach a checkpoint to B's PR by surrogate id.
    const result = await a.checkpoints.upsertOnSubmit({
      pullRequestId: bPr.id,
      reviewerId: REVIEWER,
      lastSubmittedSha: "a".repeat(40),
      submittedAt: new Date(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected a rejection");
    }
    expect(result.error.code).toBe(RepositoryErrorCode.PARENT_NOT_IN_TENANT);

    // No row was written under EITHER tenant.
    expect(await a.checkpoints.get(bPr.id, REVIEWER)).toBeUndefined();
    expect(await b.checkpoints.get(bPr.id, REVIEWER)).toBeUndefined();
  });

  it("setState on a PR outside the tenant returns notFound", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const b = forTenant(handle, CTX_B);

    const bPr = await b.pullRequests.upsert(upsertInput(7));
    const result = await a.pullRequests.setState(bPr.id, {
      state: PrState.CLOSED,
      closedAt: new Date(),
      purgeAfter: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected a rejection");
    }
    expect(result.error.code).toBe(RepositoryErrorCode.NOT_FOUND);
    // B's PR is untouched.
    expect((await b.pullRequests.getByNumber(REPO, 7))?.state).toBe(PrState.OPEN);
  });
});

describe("forTenant — idempotent upserts", () => {
  it("pull_request upsert is idempotent and mutates state in place", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);

    const first = await a.pullRequests.upsert(upsertInput(7, { state: PrState.OPEN }));
    const second = await a.pullRequests.upsert(upsertInput(7, { state: PrState.MERGED, closedAt: new Date(), purgeAfter: null }));

    expect(second.id).toBe(first.id); // same row
    expect(second.state).toBe(PrState.MERGED); // updated in place
  });

  it("reopening a closed PR disarms retention (PR #23 review)", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);

    const closed = await a.pullRequests.upsert(
      upsertInput(7, {
        state: PrState.CLOSED,
        closedAt: new Date("2026-07-01T00:00:00Z"),
        purgeAfter: new Date("2026-07-08T00:00:00Z"),
      }),
    );
    expect(closed.purgeAfter).not.toBeNull();

    // Reopen via BOTH mutation paths; each must clear the armed sweep fields.
    const viaUpsert = await a.pullRequests.upsert(upsertInput(7, { state: PrState.OPEN }));
    expect(viaUpsert.closedAt).toBeNull();
    expect(viaUpsert.purgeAfter).toBeNull();

    await a.pullRequests.setState(closed.id, {
      state: PrState.CLOSED,
      closedAt: new Date("2026-07-01T00:00:00Z"),
      purgeAfter: new Date("2026-07-08T00:00:00Z"),
    });
    const viaSetState = await a.pullRequests.setState(closed.id, { state: PrState.OPEN });
    expect(viaSetState.ok).toBe(true);
    if (!viaSetState.ok) throw new Error("expected success");
    expect(viaSetState.value.closedAt).toBeNull();
    expect(viaSetState.value.purgeAfter).toBeNull();
  });

  it("checkpoint upsertOnSubmit is idempotent and advances the sha", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const pr = await a.pullRequests.upsert(upsertInput(7));

    const first = await a.checkpoints.upsertOnSubmit({
      pullRequestId: pr.id,
      reviewerId: REVIEWER,
      lastSubmittedSha: "a".repeat(40),
      submittedAt: new Date(),
    });
    const second = await a.checkpoints.upsertOnSubmit({
      pullRequestId: pr.id,
      reviewerId: REVIEWER,
      lastSubmittedSha: "b".repeat(40),
      submittedAt: new Date(),
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("expected both submits to succeed");
    }
    expect(second.value.id).toBe(first.value.id); // one row per (reviewer, PR)
    expect(second.value.lastSubmittedSha).toBe("b".repeat(40));
  });

  it("sessions honour tenant scope on lookup and delete", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const b = forTenant(handle, CTX_B);

    await a.sessions.create({
      sessionTokenHash: "hash-a",
      reviewerId: REVIEWER,
      ghTokenCiphertext: "cipher",
      keyRef: "env:K1",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    // B cannot see A's session even by its token hash.
    expect(await b.sessions.getByTokenHash("hash-a")).toBeUndefined();
    expect(await a.sessions.getByTokenHash("hash-a")).toBeDefined();

    // B's delete-by-reviewer does not touch A's row.
    expect(await b.sessions.deleteByReviewer(REVIEWER)).toBe(0);
    expect(await a.sessions.getByTokenHash("hash-a")).toBeDefined();
  });
});

describe("parseTenantContext — boundary validation", () => {
  it("accepts installationId as bigint, number, or numeric string", () => {
    expect(parseTenantContext({ installationId: 42n }).installationId).toBe(42n);
    expect(parseTenantContext({ installationId: 42 }).installationId).toBe(42n);
    expect(parseTenantContext({ installationId: "42" }).installationId).toBe(42n);
  });

  it("accepts the worker payload's snake_case key", () => {
    expect(parseTenantContext({ installation_id: "99" }).installationId).toBe(99n);
  });

  it("rejects non-positive or non-integral installation ids", () => {
    expect(safeParseTenantContext({ installationId: 0 }).ok).toBe(false);
    expect(safeParseTenantContext({ installationId: -5 }).ok).toBe(false);
    expect(safeParseTenantContext({ installationId: "abc" }).ok).toBe(false);
    expect(safeParseTenantContext({}).ok).toBe(false);
  });
});

describe("compile-time containment (D2b)", () => {
  it("the opaque AppDatabase exposes no queryable surface", () => {
    // A live handle carries none of drizzle's query methods — the only thing
    // a consumer can do with it is pass it to forTenant.
    expectTypeOf<AppDatabase>().not.toHaveProperty("insert");
    expectTypeOf<AppDatabase>().not.toHaveProperty("select");
    expectTypeOf<AppDatabase>().not.toHaveProperty("update");
    expectTypeOf<AppDatabase>().not.toHaveProperty("delete");
    expectTypeOf<AppDatabase>().not.toHaveProperty("transaction");
    // createDb hands back exactly the opaque handle, not a raw drizzle db.
    expectTypeOf(createDb).returns.toEqualTypeOf<AppDatabase>();
    // The repository's row type is the schema select shape, not a db handle.
    expectTypeOf<PullRequestRow>().toHaveProperty("installationId");
  });

  it("TenantRepository offers no path to an unscoped query", () => {
    // No raw-handle escape hatch on the consumer-facing interface — the
    // stage-4 ArtifactStore uses the in-package internal() unwrap instead.
    expectTypeOf<TenantRepository>().not.toHaveProperty("withTenant");
    // And no drizzle query surface directly on the repository either.
    expectTypeOf<TenantRepository>().not.toHaveProperty("insert");
    expectTypeOf<TenantRepository>().not.toHaveProperty("select");
    expectTypeOf<TenantRepository>().not.toHaveProperty("update");
    expectTypeOf<TenantRepository>().not.toHaveProperty("delete");
    expectTypeOf<TenantRepository>().not.toHaveProperty("transaction");
  });
});
