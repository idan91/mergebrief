// Owner-scoped (url-box) world tests. Prove the second tenancy world end to
// end: owner rows stamp `owner_user_id` + `source` with a NULL
// `installation_id`, owners are isolated from each other AND from
// installation tenants, child writes verify the parent across worlds, and the
// DB CHECK forbids a row claiming both worlds or neither.
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ClaimOutcomes,
  createArtifactStore,
  createGenerationProjection,
  createPurgeRoutines,
  createTenantRepository,
  parseScopeContext,
  resolveUrlBoxOwner,
  safeParseScopeContext,
  ScopeViolationError,
  type OwnerContext,
  type TenantContext,
} from "../src/index";
import { PrStates, PullRequestSources } from "types/pull-requests";
import { ReviewOutcomes } from "types/reviews";
import {
  isInstallationId,
  isRepoId,
  isReviewerId,
  type InstallationId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { internal } from "../src/db/handle";
import { succeedTestRun } from "../src/testing";
import { auditLog } from "../src/schema/audit-log";
import { pullRequest } from "../src/schema/pull-request";
import {
  brandWith,
  createQueryLog,
  expectCheckViolation,
  readCheckValues,
  recordStatements,
  registerSharedPglite,
} from "./helpers";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const shared = registerSharedPglite();

const TENANT: InstallationId = brandWith(isInstallationId, 1000n);
const OWNER_A: ReviewerId = brandWith(isReviewerId, 501n);
const OWNER_B: ReviewerId = brandWith(isReviewerId, 502n);
const REPO: RepoId = brandWith(isRepoId, 777n);

const TENANT_CTX: TenantContext = { installationId: TENANT };
const CTX_A: OwnerContext = { ownerUserId: OWNER_A };
const CTX_B: OwnerContext = { ownerUserId: OWNER_B };

const OPEN = { state: PrStates.OPEN } as const;

function upsertInput(prNumber: number) {
  return { repoId: REPO, prNumber, repoSlug: "acme/widgets", ...OPEN };
}

const ORIGIN = {
  provider: "anthropic",
  model: "m",
  effort: "high",
  bodyVersion: STORED_BODY_VERSION,
} as const;

describe("owner-scoped pull_request rows", () => {
  it("stamps owner_user_id, source url, and a NULL installation_id", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);

    const row = await a.pullRequests.upsert(upsertInput(7));
    expect(row.installationId).toBeNull();
    expect(row.ownerUserId).toBe(OWNER_A);
    expect(row.source).toBe(PullRequestSources.URL);
  });

  it("installation upserts stamp source installation and no owner", async () => {
    const handle = shared.handle;
    const t = createTenantRepository(handle, TENANT_CTX);

    const row = await t.pullRequests.upsert(upsertInput(7));
    expect(row.installationId).toBe(TENANT);
    expect(row.ownerUserId).toBeNull();
    expect(row.source).toBe(PullRequestSources.INSTALLATION);
  });

  it("owner upsert is idempotent: one row per owner, repo and number", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);

    const first = await a.pullRequests.upsert(upsertInput(7));
    const second = await a.pullRequests.upsert({
      ...upsertInput(7),
      title: "second",
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("second");
  });

  it("two owners and a tenant hold independent rows for one repo and number", async () => {
    const handle = shared.handle;
    const t = createTenantRepository(handle, TENANT_CTX);
    const a = createTenantRepository(handle, CTX_A);
    const b = createTenantRepository(handle, CTX_B);

    const tRow = await t.pullRequests.upsert(upsertInput(7));
    const aRow = await a.pullRequests.upsert(upsertInput(7));
    const bRow = await b.pullRequests.upsert(upsertInput(7));
    expect(new Set([tRow.id, aRow.id, bRow.id]).size).toBe(3);

    // Each scope reads only its own row back.
    expect((await t.pullRequests.getByNumber(REPO, 7))?.id).toBe(tRow.id);
    expect((await a.pullRequests.getByNumber(REPO, 7))?.id).toBe(aRow.id);
    expect((await b.pullRequests.getByNumber(REPO, 7))?.id).toBe(bRow.id);
  });

  it("an owner cannot read another owner's row by id", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const b = createTenantRepository(handle, CTX_B);

    const bRow = await b.pullRequests.upsert(upsertInput(7));
    expect(await a.pullRequests.getById(bRow.id)).toBeUndefined();
  });
});

describe("owner-scoped child writes verify the parent across worlds", () => {
  it("rejects a checkpoint attached to another owner's pull_request", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const b = createTenantRepository(handle, CTX_B);

    const bPr = await b.pullRequests.upsert(upsertInput(7));
    const crossOwnerWrite = a.checkpoints.upsertOnSubmit({
      pullRequestId: bPr.id,
      reviewerId: OWNER_A,
      lastSubmittedSha: "a".repeat(40),
      submittedAt: new Date(),
    });
    await expect(crossOwnerWrite).rejects.toBeInstanceOf(ScopeViolationError);
    expect(await b.checkpoints.get(bPr.id, OWNER_A)).toBeUndefined();
  });

  it("rejects an owner checkpoint attached to a tenant pull_request", async () => {
    const handle = shared.handle;
    const t = createTenantRepository(handle, TENANT_CTX);
    const a = createTenantRepository(handle, CTX_A);

    const tPr = await t.pullRequests.upsert(upsertInput(7));
    const crossWorldWrite = a.checkpoints.upsertOnSubmit({
      pullRequestId: tPr.id,
      reviewerId: OWNER_A,
      lastSubmittedSha: "a".repeat(40),
      submittedAt: new Date(),
    });
    await expect(crossWorldWrite).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it("accepts and re-reads a checkpoint on the owner's own pull_request", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    await a.checkpoints.upsertOnSubmit({
      pullRequestId: pr.id,
      reviewerId: OWNER_A,
      lastSubmittedSha: "a".repeat(40),
      submittedAt: new Date(),
    });
    expect(await a.checkpoints.get(pr.id, OWNER_A)).toBeDefined();
  });
});

describe("owner-scoped artifact store", () => {
  it("writes and re-reads a brief under owner scope; upsert is idempotent", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    const input = {
      pullRequestId: pr.id,
      baseSha: "b".repeat(40),
      headSha: "h".repeat(40),
      headIndex: 1,
      commitCount: 3,
      body: '{"v":"brief-body"}',
      ...ORIGIN,
      usedGroupIds: [],
    };
    const first = await store.briefs.write(input);
    const second = await store.briefs.write({
      ...input,
      body: '{"v":"rewritten"}',
    });
    expect(second.id).toBe(first.id);
    expect(second.installationId).toBeNull();

    const read = await store.briefs.get(pr.id, input.baseSha, input.headSha);
    expect(read?.body).toBe('{"v":"rewritten"}');
  });

  it("another owner cannot read or write against the first owner's PR", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const storeA = createArtifactStore(handle, CTX_A);
    const storeB = createArtifactStore(handle, CTX_B);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    const input = {
      pullRequestId: pr.id,
      baseSha: "b".repeat(40),
      headSha: "h".repeat(40),
      headIndex: 1,
      commitCount: 1,
      body: '{"v":"secret"}',
      ...ORIGIN,
      usedGroupIds: [],
    };
    await storeA.briefs.write(input);

    expect(
      await storeB.briefs.get(pr.id, input.baseSha, input.headSha),
    ).toBeUndefined();
    expect(await storeB.briefs.listForPullRequest(pr.id)).toEqual([]);
    await expect(storeB.briefs.write(input)).rejects.toBeInstanceOf(
      ScopeViolationError,
    );
  });

  it("the installation tenant cannot see an owner's artifacts", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const storeA = createArtifactStore(handle, CTX_A);
    const storeT = createArtifactStore(handle, TENANT_CTX);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    await storeA.briefs.write({
      pullRequestId: pr.id,
      baseSha: "b".repeat(40),
      headSha: "h".repeat(40),
      headIndex: 1,
      commitCount: 1,
      body: '{"v":"secret"}',
      ...ORIGIN,
      usedGroupIds: [],
    });
    expect(await storeT.briefs.listForPullRequest(pr.id)).toEqual([]);
  });
});

describe("owner-scoped span artifacts", () => {
  const HOP = [{ file: "src/a.ts", hunks: [] }];

  function makeMarks(baselineSha: string, headSha: string) {
    return { baselineSha, headSha, files: [] };
  }

  async function writeEverySpanArtifact(
    store: ReturnType<typeof createArtifactStore>,
    pullRequestId: Parameters<typeof store.briefs.listForPullRequest>[0],
  ) {
    const brief = await store.briefs.write({
      pullRequestId,
      baseSha: "base",
      headSha: "head",
      headIndex: 1,
      commitCount: 1,
      body: '{"v":"brief"}',
      repoConfig: "{}",
      ...ORIGIN,
      usedGroupIds: [],
    });
    const delta = await store.deltas.write({
      pullRequestId,
      baselineSha: "chk",
      headSha: "head",
      body: '{"v":"delta"}',
      ...ORIGIN,
    });
    const narrative = await store.revisionNarratives.write({
      pullRequestId,
      briefId: brief.id,
      prevHeadSha: "prev",
      headSha: "head",
      body: '{"v":"narrative"}',
      ...ORIGIN,
    });
    const marks = await store.comparisonMarks.write({
      pullRequestId,
      marks: makeMarks("prev", "head"),
      refs: { prevBase: "main", newBase: "main" },
    });
    const hop = await store.hunkSpans.write({
      pullRequestId,
      baselineSha: "prev",
      headSha: "head",
      spans: HOP,
    });
    return { brief, delta, narrative, marks, hop };
  }

  it("another owner reads none of the first owner's span artifacts", async () => {
    const handle = shared.handle;
    const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert(
      upsertInput(7),
    );
    const storeA = createArtifactStore(handle, CTX_A);
    const storeB = createArtifactStore(handle, CTX_B);
    const written = await writeEverySpanArtifact(storeA, pr.id);
    expect(written.hop.installationId).toBeNull();

    expect(await storeB.briefs.getRepoConfig(pr.id, "base", "head")).toBe(
      undefined,
    );
    expect(await storeB.deltas.get(pr.id, "chk", "head")).toBeUndefined();
    expect(
      await storeB.revisionNarratives.get(pr.id, "prev", "head"),
    ).toBeUndefined();
    expect(
      await storeB.comparisonMarks.get(pr.id, "prev", "head"),
    ).toBeUndefined();
    expect(await storeB.deltas.listForPullRequest(pr.id)).toEqual([]);
    expect(await storeB.revisionNarratives.listForPullRequest(pr.id)).toEqual(
      [],
    );
    expect(await storeB.comparisonMarks.listForPullRequest(pr.id)).toEqual([]);
    expect(await storeB.hunkSpans.listForPullRequest(pr.id)).toEqual([]);
    expect((await storeB.briefs.latestForPullRequests([pr.id])).size).toBe(0);

    // The owner itself reads every row back through the semi-join.
    expect(await storeA.briefs.getRepoConfig(pr.id, "base", "head")).toBe("{}");
    expect((await storeA.deltas.get(pr.id, "chk", "head"))?.id).toBe(
      written.delta.id,
    );
    expect(
      (await storeA.revisionNarratives.get(pr.id, "prev", "head"))?.id,
    ).toBe(written.narrative.id);
    expect((await storeA.comparisonMarks.get(pr.id, "prev", "head"))?.id).toBe(
      written.marks.id,
    );
    expect(
      (await storeA.hunkSpans.listForPullRequest(pr.id)).map((row) => row.id),
    ).toEqual([written.hop.id]);
  });

  it("another owner cannot write span artifacts onto the first owner's PR", async () => {
    const handle = shared.handle;
    const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert(
      upsertInput(7),
    );
    const storeA = createArtifactStore(handle, CTX_A);
    const storeB = createArtifactStore(handle, CTX_B);
    const own = await writeEverySpanArtifact(storeA, pr.id);

    const refusals = [
      storeB.deltas.write({
        pullRequestId: pr.id,
        baselineSha: "chk-2",
        headSha: "head",
        body: '{"v":"planted"}',
        ...ORIGIN,
      }),
      storeB.revisionNarratives.write({
        pullRequestId: pr.id,
        briefId: own.brief.id,
        prevHeadSha: "prev-2",
        headSha: "head",
        body: '{"v":"planted"}',
        ...ORIGIN,
      }),
      storeB.comparisonMarks.write({
        pullRequestId: pr.id,
        refs: { prevBase: "main", newBase: "main" },
        marks: makeMarks("prev-2", "head"),
      }),
      storeB.hunkSpans.write({
        pullRequestId: pr.id,
        baselineSha: "prev-2",
        headSha: "head",
        spans: HOP,
      }),
    ];
    for (const refusal of refusals) {
      await expect(refusal).rejects.toBeInstanceOf(ScopeViolationError);
      await expect(refusal).rejects.toThrow(/^pull_request /);
    }

    // Owner A still sees only its own rows: nothing was planted.
    expect(await storeA.deltas.listForPullRequest(pr.id)).toEqual([
      { baselineSha: "chk", headSha: "head", skipped: false, unchanged: false },
    ]);
    expect(await storeA.revisionNarratives.listForPullRequest(pr.id)).toEqual([
      {
        prevHeadSha: "prev",
        headSha: "head",
        unchanged: false,
        skipped: false,
      },
    ]);
    expect(await storeA.comparisonMarks.listForPullRequest(pr.id)).toEqual([
      { baselineSha: "prev", headSha: "head" },
    ]);
    expect(await storeA.hunkSpans.listForPullRequest(pr.id)).toHaveLength(1);
  });

  it("a narrative anchored to another owner's brief is refused", async () => {
    const handle = shared.handle;
    const prA = await createTenantRepository(handle, CTX_A).pullRequests.upsert(
      upsertInput(7),
    );
    const prB = await createTenantRepository(handle, CTX_B).pullRequests.upsert(
      upsertInput(8),
    );
    const storeB = createArtifactStore(handle, CTX_B);
    const briefA = await createArtifactStore(handle, CTX_A).briefs.write({
      pullRequestId: prA.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 1,
      commitCount: 1,
      body: '{"v":"brief"}',
      ...ORIGIN,
      usedGroupIds: [],
    });

    const refused = storeB.revisionNarratives.write({
      pullRequestId: prB.id,
      briefId: briefA.id,
      prevHeadSha: "prev",
      headSha: "head",
      body: '{"v":"narrative"}',
      ...ORIGIN,
    });

    await expect(refused).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(refused).rejects.toThrow(/^brief /);
    expect(await storeB.revisionNarratives.listForPullRequest(prB.id)).toEqual(
      [],
    );
  });
});

describe("owner-scoped span artifact query shape", () => {
  const OWNER_PARENT_CHECK =
    'select "id" from "pull_request" where (("pull_request"."installation_id" is null and "pull_request"."owner_user_id" = $1) and "pull_request"."id" = $2) limit $3';

  function collapseWhitespace(statement: string): string {
    return statement.replace(/\s+/g, " ");
  }

  /** The owner-world child predicate: the NULL world mark plus the owner semi-join. */
  function shapeOwnerFilter(table: string): string {
    return `("${table}"."installation_id" is null and "${table}"."pull_request_id" in ( select "pull_request"."id" from "pull_request" where "pull_request"."owner_user_id" = $1 and "pull_request"."installation_id" is null ))`;
  }

  function shapeSpanRead(table: string, lowerSha: string): RegExp {
    const where = `where (${shapeOwnerFilter(table)} and "${table}"."pull_request_id" = $2 and "${table}"."${lowerSha}" = $3 and "${table}"."head_sha" = $4) limit $5`;
    return new RegExp(`^select .* from "${table}" ${escapeRegExp(where)}$`);
  }

  function shapeListRead(table: string, orderBy = ""): RegExp {
    const where = `where (${shapeOwnerFilter(table)} and "${table}"."pull_request_id" = $2)${orderBy}`;
    return new RegExp(`^select .* from "${table}" ${escapeRegExp(where)}$`);
  }

  function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function makeLoggedOwnerStore() {
    const log = await createQueryLog();
    const pr = await createTenantRepository(
      log.handle,
      CTX_A,
    ).pullRequests.upsert(upsertInput(7));
    return { log, store: createArtifactStore(log.handle, CTX_A), pr };
  }

  it("owner-world reads semi-join the pull request on every table", async () => {
    const { log, store, pr } = await makeLoggedOwnerStore();

    const reads: readonly (readonly [
      string,
      string,
      () => Promise<unknown>,
    ])[] = [
      ["brief", "base_sha", () => store.briefs.get(pr.id, "a", "b")],
      ["brief", "base_sha", () => store.briefs.getRepoConfig(pr.id, "a", "b")],
      ["delta", "baseline_sha", () => store.deltas.get(pr.id, "a", "b")],
      [
        "revision_narrative",
        "prev_head_sha",
        () => store.revisionNarratives.get(pr.id, "a", "b"),
      ],
      [
        "comparison_marks",
        "baseline_sha",
        () => store.comparisonMarks.get(pr.id, "a", "b"),
      ],
    ];
    for (const [table, lowerSha, read] of reads) {
      const { statements } = await recordStatements(log, read);
      const ranStatements = statements.map(collapseWhitespace);
      const expectedRead = shapeSpanRead(table, lowerSha);
      expect(ranStatements).toEqual([expect.stringMatching(expectedRead)]);
    }

    const lists: readonly (readonly [
      string,
      () => Promise<unknown>,
      string?,
    ])[] = [
      [
        "brief",
        () => store.briefs.listForPullRequest(pr.id),
        ' order by "brief"."head_index"',
      ],
      ["delta", () => store.deltas.listForPullRequest(pr.id)],
      [
        "revision_narrative",
        () => store.revisionNarratives.listForPullRequest(pr.id),
      ],
      [
        "comparison_marks",
        () => store.comparisonMarks.listForPullRequest(pr.id),
      ],
      [
        "hunk_span",
        () => store.hunkSpans.listForPullRequest(pr.id),
        ' order by "hunk_span"."id" asc',
      ],
    ];
    for (const [table, list, orderBy] of lists) {
      const { statements } = await recordStatements(log, list);
      const ranStatements = statements.map(collapseWhitespace);
      const expectedList = shapeListRead(table, orderBy);
      expect(ranStatements).toEqual([expect.stringMatching(expectedList)]);
    }

    const latest = await recordStatements(log, () =>
      store.briefs.latestForPullRequests([pr.id]),
    );
    const latestStatements = latest.statements.map(collapseWhitespace);
    const ownerFilter = escapeRegExp(shapeOwnerFilter("brief"));
    const expectedLatest = new RegExp(
      `^select distinct on .* from "brief" where \\(${ownerFilter} and "brief"\\."pull_request_id" in \\(\\$2\\)\\) order by`,
    );
    expect(latestStatements).toEqual([expect.stringMatching(expectedLatest)]);
  });

  it("owner-world writes resolve the parent by owner inside the transaction", async () => {
    const { log, store, pr } = await makeLoggedOwnerStore();
    const brief = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 1,
      commitCount: 1,
      body: '{"v":"brief"}',
      ...ORIGIN,
      usedGroupIds: [],
    });

    const marks = await recordStatements(log, () =>
      store.comparisonMarks.write({
        pullRequestId: pr.id,
        refs: { prevBase: "main", newBase: "main" },
        marks: { baselineSha: "prev", headSha: "head", files: [] },
      }),
    );
    const narrative = await recordStatements(log, () =>
      store.revisionNarratives.write({
        pullRequestId: pr.id,
        briefId: brief.id,
        prevHeadSha: "prev",
        headSha: "head",
        body: '{"v":"narrative"}',
        ...ORIGIN,
      }),
    );

    expect(marks.statements).toEqual([
      "begin",
      OWNER_PARENT_CHECK,
      expect.stringMatching(/^insert into "comparison_marks" /),
      "commit",
    ]);
    expect(narrative.statements.map(collapseWhitespace)).toEqual([
      "begin",
      OWNER_PARENT_CHECK,
      `select "id" from "brief" where (${shapeOwnerFilter("brief")} and "brief"."id" = $2 and "brief"."pull_request_id" = $3) limit $4`,
      expect.stringMatching(/^insert into "revision_narrative" /),
      "commit",
    ]);
  });
});

describe("owner-scoped generation projection", () => {
  it("projects pending → running → succeeded for an owner PR", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const projection = createGenerationProjection(handle, CTX_A);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    const target = {
      pullRequestId: pr.id,
      kind: "brief",
      headSha: "h".repeat(40),
      baselineSha: null,
    } as const;
    await projection.upsertPending(target);
    const done = await succeedTestRun(projection, target);
    expect(done.installationId).toBeNull();
  });

  it("spend counting is one shared instance pool across worlds", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const projA = createGenerationProjection(handle, CTX_A);
    const projT = createGenerationProjection(handle, TENANT_CTX);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    const target = {
      pullRequestId: pr.id,
      kind: "brief",
      headSha: "h".repeat(40),
      baselineSha: null,
    } as const;
    await projA.upsertPending(target);
    const window = {
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    };
    const claimed = await projA.claimRun({
      target,
      leaseMs: 120_000,
      ...window,
    });
    expect(claimed.ok && claimed.value.kind).toBe(ClaimOutcomes.CLAIMED);

    // The cap is the INSTANCE's budget: the owner's started run is visible
    // from every scope, so N viewers cannot multiply the daily spend.
    expect(await projA.countStartedRuns(window)).toBe(1);
    expect(await projT.countStartedRuns(window)).toBe(1);
  });

  it("an owner cannot enqueue against another owner's PR", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const projB = createGenerationProjection(handle, CTX_B);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    const crossOwnerEnqueue = projB.upsertPending({
      pullRequestId: pr.id,
      kind: "brief",
      headSha: "h".repeat(40),
      baselineSha: null,
    });
    await expect(crossOwnerEnqueue).rejects.toBeInstanceOf(ScopeViolationError);
  });
});

describe("owner-scoped purge, the owner-delete operation's backing", () => {
  it("purges the owner's PR, cascades children, audits with source url-box", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const purge = createPurgeRoutines(handle, CTX_A);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "b".repeat(40),
      headSha: "h".repeat(40),
      headIndex: 1,
      commitCount: 1,
      body: '{"v":"body"}',
      ...ORIGIN,
      usedGroupIds: [],
    });

    const purged = await purge.purgePullRequest(pr.id);
    expect(purged).toBe(true);
    expect(await a.pullRequests.getById(pr.id)).toBeUndefined();

    const entries = await internal(handle)
      .select()
      .from(auditLog)
      .where(sql`${auditLog.operation} = 'delete'`);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.installationId).toBeNull();
    expect(entries[0]?.source).toBe(PullRequestSources.URL);
  });

  it("cannot purge another owner's PR", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const purgeB = createPurgeRoutines(handle, CTX_B);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    const purged = await purgeB.purgePullRequest(pr.id);
    expect(purged).toBe(false);
    expect(await a.pullRequests.getById(pr.id)).toBeDefined();
  });

  it("cannot purge a tenant PR from an owner scope", async () => {
    const handle = shared.handle;
    const t = createTenantRepository(handle, TENANT_CTX);
    const purgeA = createPurgeRoutines(handle, CTX_A);

    const pr = await t.pullRequests.upsert(upsertInput(7));
    const purged = await purgeA.purgePullRequest(pr.id);
    expect(purged).toBe(false);
  });
});

describe("pull_request owner-shape CHECK", () => {
  it.each(["pull_request_owner_shape", "audit_log_source_shape"])(
    "%s accepts exactly the source map",
    async (name) => {
      const client = shared.client;
      expect((await readCheckValues(client, name)).toSorted()).toEqual(
        Object.values(PullRequestSources).toSorted(),
      );
    },
  );

  it("rejects a row claiming both worlds", async () => {
    const handle = shared.handle;
    await expectCheckViolation(
      internal(handle).insert(pullRequest).values({
        installationId: TENANT,
        ownerUserId: OWNER_A,
        source: PullRequestSources.URL,
        repoId: REPO,
        prNumber: 1,
        state: PrStates.OPEN,
      }),
      "pull_request_owner_shape",
    );
  });

  it("rejects a row claiming neither world", async () => {
    const handle = shared.handle;
    await expectCheckViolation(
      internal(handle).insert(pullRequest).values({
        installationId: null,
        ownerUserId: null,
        repoId: REPO,
        prNumber: 1,
        state: PrStates.OPEN,
      }),
      "pull_request_owner_shape",
    );
  });

  it("rejects a source that disagrees with the world", async () => {
    const handle = shared.handle;
    await expectCheckViolation(
      internal(handle).insert(pullRequest).values({
        installationId: TENANT,
        source: PullRequestSources.URL,
        repoId: REPO,
        prNumber: 1,
        state: PrStates.OPEN,
      }),
      "pull_request_owner_shape",
    );
  });
});

describe("parseScopeContext boundary validation", () => {
  it("parses an installation scope from either casing", () => {
    expect(parseScopeContext({ installationId: 42n })).toEqual({
      installationId: 42n,
    });
    expect(parseScopeContext({ installation_id: "42" })).toEqual({
      installationId: 42n,
    });
  });

  it("parses an owner scope from either casing", () => {
    expect(parseScopeContext({ ownerUserId: 7 })).toEqual({
      ownerUserId: 7n,
    });
    expect(parseScopeContext({ owner_user_id: "7" })).toEqual({
      ownerUserId: 7n,
    });
  });

  it("rejects a context naming both scopes, or neither", () => {
    expect(
      safeParseScopeContext({ installationId: 1, ownerUserId: 2 }).ok,
    ).toBe(false);
    expect(safeParseScopeContext({}).ok).toBe(false);
  });
});

describe("owner-scoped review sessions", () => {
  it("another owner cannot read or write a session on the owner's brief", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const b = createTenantRepository(handle, CTX_B);
    const t = createTenantRepository(handle, TENANT_CTX);
    const store = createArtifactStore(handle, CTX_A);

    const pr = await a.pullRequests.upsert(upsertInput(7));
    const brief = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "b".repeat(40),
      headSha: "h".repeat(40),
      headIndex: 1,
      commitCount: 1,
      body: '{"brief":true}',
      ...ORIGIN,
      usedGroupIds: [],
    });
    const key = {
      briefId: brief.id,
      reviewerId: OWNER_A,
    };

    const created = await a.reviewSessions.setOutcome(
      key,
      ReviewOutcomes.COMMENT,
    );
    expect(created.ok).toBe(true);

    // A guessed (briefId, reviewerId) pair reads nothing across owners or
    // worlds; the brief-ownership join is the isolation.
    expect(await b.reviewSessions.get(key)).toBeUndefined();
    expect(await t.reviewSessions.get(key)).toBeUndefined();
    expect(await a.reviewSessions.get(key)).toBeDefined();

    await expect(
      b.reviewSessions.setOutcome(key, ReviewOutcomes.COMMENT),
    ).rejects.toBeInstanceOf(ScopeViolationError);
  });
});

describe("url-box instance visibility", () => {
  it("returns the preferred owner's row first, then the oldest", async () => {
    const handle = shared.handle;
    // B pastes first, A second: age alone would pick B.
    await createTenantRepository(handle, CTX_B).pullRequests.upsert(
      upsertInput(9),
    );
    await createTenantRepository(handle, CTX_A).pullRequests.upsert(
      upsertInput(9),
    );

    expect(await resolveUrlBoxOwner(handle, REPO, 9, OWNER_A)).toBe(OWNER_A);
    expect(await resolveUrlBoxOwner(handle, REPO, 9, OWNER_B)).toBe(OWNER_B);
    // A third reader owns neither row and gets the oldest, deterministically.
    const stranger = brandWith(isReviewerId, 999n);
    expect(await resolveUrlBoxOwner(handle, REPO, 9, stranger)).toBe(OWNER_B);
  });

  it("never reaches an installation row", async () => {
    const handle = shared.handle;
    await createTenantRepository(handle, TENANT_CTX).pullRequests.upsert(
      upsertInput(11),
    );

    expect(await resolveUrlBoxOwner(handle, REPO, 11, OWNER_A)).toBeUndefined();
  });
});
