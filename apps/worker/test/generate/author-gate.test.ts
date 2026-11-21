import { createI18n } from "i18n";
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  parseScopeContext,
  type PullRequestRow,
} from "persistence";
import { approveTestTrigger, claimTestRun } from "persistence/testing";
import { FakeFailures, type FakeGitHub } from "github/testing";
import { RepoConfigPaths } from "repo-config";
import { GenerationFailureCodes, GenerationStatuses, PrStates } from "types";
import {
  buildEntryCommentFailedBody,
  buildEntryCommentGeneratingBody,
  buildEntryCommentOnDemandBody,
} from "../../src/task/entry-comment";
import {
  BASE,
  buildRepoFile,
  captureLogger,
  ctx,
  ENTRY_PR_VIEW,
  failFirstSettingsRead,
  failHeadReadsAfterFirst,
  FIRST_ATTEMPT,
  FIRST_BRIEF_INDEX,
  harness,
  HEAD_1,
  HEAD_2,
  interceptInstallationRepo,
  LAST_ATTEMPT,
  listCommentCalls,
  listRepoFilePaths,
  makeConnectionError,
  makeGitHub,
  makeRecoveryTask,
  makeRepoId,
  makeReviewerId,
  makeTarget,
  makeTask,
  NEWER_BODY,
  NEWER_COMMENT_ID,
  PR_REF,
  pushHeadAfterFirstRead,
  readLiveBodies,
  readRowStatus,
  refuseDiffs,
  REPO,
  runWithPullRequestsOffline,
  SECOND_ATTEMPT,
  seedViewerGrant,
  openPerTestHarness,
  setUpHarness,
  storeAnotherRunsEntry,
  stubGenerator,
  trigger,
  countStartedRuns,
} from "./helpers";

setUpHarness();

const { t } = createI18n();

const BOT_LOGIN = "renovate[bot]";
const LISTED_SETTINGS = `version: 1\ntrustedBots:\n  - ${BOT_LOGIN}\n`;
const OPT_OUT_SETTINGS = "version: 1\nentryCommentOnDrafts: false\n";

const ON_DEMAND_BODY = buildEntryCommentOnDemandBody(t, {
  ...ENTRY_PR_VIEW,
  headIndex: FIRST_BRIEF_INDEX,
});

function makeBotGitHub(headSha: string): FakeGitHub {
  const github = makeGitHub(headSha);
  github.updatePullRequest(PR_REF, {
    authorLogin: BOT_LOGIN,
    authorIsBot: true,
  });
  return github;
}

function addSettings(github: FakeGitHub, content: string, ref?: string): void {
  const file = buildRepoFile(content, "sha-settings");
  if (ref === undefined) {
    github.addRepoFile(REPO, { path: RepoConfigPaths.SETTINGS }, file);
    return;
  }
  github.addRepoFile(REPO, { path: RepoConfigPaths.SETTINGS, ref }, file);
}

async function countAttempts(): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as total from generation_attempt",
  );
  return Number(rows[0]?.["total"]);
}

async function countGenerateJobs(): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as total from graphile_worker.jobs where task_identifier = 'generate'",
  );
  return Number(rows[0]?.["total"]);
}

const COMMENT_READ_FAILURE = "comment read failed";

/** The next run's first Entry comment read throws; later reads answer. */
function throwOnFirstCommentRead(github: FakeGitHub): void {
  let reads = 0;
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async fetchComment(commentId) {
      reads += 1;
      if (reads === 1) {
        throw new Error(COMMENT_READ_FAILURE);
      }
      return client.fetchComment(commentId);
    },
  }));
}

async function approveTrigger(pr: PullRequestRow): Promise<void> {
  await approveTestTrigger(harness.handle, ctx, pr.id, makeReviewerId(900n));
}

describe("generate task, author gate", () => {
  it("announces an awaiting-trigger head with no claim and no spend", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const github = makeGitHub(HEAD_1);
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(await countAttempts()).toBe(0);
    expect(await countStartedRuns()).toBe(0);
    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
    expect(github.listCalls("fetchDiff")).toEqual([]);
  });

  it("links a gated push over a stored brief to the rev it would take", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await makeTask({ github })(first.payload);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2, { requiresTriggerApproval: true });
    await makeTask({ github })(second.payload);

    expect(await readRowStatus(second.pr, HEAD_2)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    const onDemand = buildEntryCommentOnDemandBody(t, {
      ...ENTRY_PR_VIEW,
      headIndex: FIRST_BRIEF_INDEX + 1,
    });
    expect(readLiveBodies(github)).toEqual([onDemand]);
    expect(onDemand).toContain("/pulls/7?rev=2)");
  });

  it("posts no on-demand body once a newer push owns the thread", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const github = makeGitHub(HEAD_1);
    pushHeadAfterFirstRead(github, HEAD_2);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(listCommentCalls(github)).not.toContain("post");
    expect(readLiveBodies(github)).toEqual([]);
  });

  it("posts no on-demand body over another Entry when the head is unread", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const github = makeGitHub(HEAD_1);
    await storeAnotherRunsEntry(github, pr.id, {
      id: NEWER_COMMENT_ID,
      body: NEWER_BODY,
    });
    failHeadReadsAfterFirst(github);
    const { logger, readLines } = captureLogger();

    await makeTask({ github, log: logger })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(listCommentCalls(github)).not.toContain("post");
    expect(readLiveBodies(github)).toEqual([NEWER_BODY]);
    const standDown = readLines().find((line) =>
      String(line["msg"]).includes("the on-demand Entry stands down"),
    );
    expect(standDown?.["level"]).toBe("warn");
    expect(String(standDown?.["error"])).toContain("fetchPullRequest");
  });

  it("keeps a gated head held through a transient failure and its retry", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const github = makeGitHub(HEAD_1);
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
    const generator = stubGenerator();

    await expect(
      makeTask({ github, generator })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("502");
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );

    const retried = makeGitHub(HEAD_1);
    await makeTask({ github: retried, generator })(payload, {
      job: SECOND_ATTEMPT,
    });

    expect(generator.calls).toEqual([]);
    expect(await countAttempts()).toBe(0);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(readLiveBodies(retried)).toEqual([ON_DEMAND_BODY]);
  });

  it("keeps a gated head's thread on its last failed attempt", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    await makeTask({ github })(payload, { job: FIRST_ATTEMPT });
    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
    const attemptsBefore = await countAttempts();
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);

    await expect(
      makeTask({ github })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("502");

    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(await countAttempts()).toBe(attemptsBefore);
  });

  it("keeps the on-demand body when a gated run's last attempt throws", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    await makeTask({ github })(payload, { job: FIRST_ATTEMPT });
    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
    throwOnFirstCommentRead(github);

    await expect(
      makeTask({ github })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow(COMMENT_READ_FAILURE);

    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(await countAttempts()).toBe(0);
  });

  it("keeps a gated head held when its first read throws", async () => {
    await openPerTestHarness();
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const github = makeGitHub(HEAD_1);
    const generator = stubGenerator();

    const task = makeTask({ github, generator });
    const run = runWithPullRequestsOffline(() =>
      task(payload, { job: FIRST_ATTEMPT }),
    );
    await expect(run).rejects.toThrow("Failed query");
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    await makeTask({ github, generator })(payload, {
      job: SECOND_ATTEMPT,
    });

    expect(generator.calls).toEqual([]);
    expect(await countAttempts()).toBe(0);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
  });

  it("keeps a gated head awaiting when its PR closed before the run", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    await harness.raw(
      "update pull_request set state = 'closed' where id = $1::bigint",
      [String(pr.id)],
    );

    await makeTask({ github: makeGitHub(HEAD_1) })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
  });

  it("skips the on-demand post when a click lands before it", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const target = makeTarget(pr, HEAD_1);
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async fetchRepoFile(file) {
        await approveTrigger(pr);
        await createGenerationProjection(harness.handle, ctx).upsertPending(
          target,
        );
        return client.fetchRepoFile(file);
      },
    }));

    await makeTask({ github })(payload);

    expect(listCommentCalls(github)).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.PENDING);
  });

  it("does not re-ping when the on-demand body is already live", async () => {
    const first = await trigger(HEAD_1, { requiresTriggerApproval: true });
    const github = makeGitHub(HEAD_1);
    await makeTask({ github })(first.payload);
    await makeTask({ github })(first.payload);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2, { requiresTriggerApproval: true });

    await makeTask({ github })(second.payload);

    expect(listCommentCalls(github).filter((call) => call === "post")).toEqual([
      "post",
    ]);
    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
  });

  it("posts nothing for a gated draft whose repo turned draft Entries off", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    addSettings(github, OPT_OUT_SETTINGS);

    await makeTask({ github })(payload);

    expect(listCommentCalls(github)).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
  });

  it("generates a bot PR whose login the default branch lists", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeBotGitHub(HEAD_1);
    addSettings(github, LISTED_SETTINGS);
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    expect(generator.calls).toContain("brief");
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    const settingsReads = listRepoFilePaths(github).filter(
      (path) => path === RepoConfigPaths.SETTINGS,
    );
    expect(settingsReads).toHaveLength(1);
  });

  it("generates a listed bot PR whose settings read clears in the run", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeBotGitHub(HEAD_1);
    addSettings(github, LISTED_SETTINGS);
    const failing = makeBotGitHub(HEAD_1);
    failing.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    const reads = failFirstSettingsRead(github, failing);
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload, { job: FIRST_ATTEMPT });

    expect(reads.count).toBe(2);
    expect(generator.calls).toContain("brief");
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("holds an unlisted bot PR awaiting trigger with no claim", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeBotGitHub(HEAD_1);
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(await countAttempts()).toBe(0);
    expect(await countStartedRuns()).toBe(0);
    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
  });

  it("reads the bot list from the default branch only", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeBotGitHub(HEAD_1);
    addSettings(github, LISTED_SETTINGS, "feature/stub");
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
  });

  it("retries a bot PR whose settings read fails transiently", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeBotGitHub(HEAD_1);
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    const generator = stubGenerator();

    await expect(
      makeTask({ github, generator })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("settings read failed");
    const interim = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(interim?.status).toBe(GenerationStatuses.FAILED);
    expect(interim?.errorCode).toBe(GenerationFailureCodes.GITHUB_UNAVAILABLE);
    expect(interim?.runId).toBeNull();
    expect(listCommentCalls(github)).toEqual([]);

    const retried = makeBotGitHub(HEAD_1);
    addSettings(retried, LISTED_SETTINGS);
    await makeTask({ github: retried, generator })(payload, {
      job: SECOND_ATTEMPT,
    });

    expect(generator.calls).toContain("brief");
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("holds a bot PR whose settings read GitHub refuses", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeBotGitHub(HEAD_1);
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.FORBIDDEN,
    );
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload, { job: FIRST_ATTEMPT });

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
  });

  it("holds a bot PR whose settings read fails on its last attempt", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeBotGitHub(HEAD_1);
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload, { job: LAST_ATTEMPT });

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(await countAttempts()).toBe(0);
  });

  it("keeps a held bot row awaiting when a later step throws", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeBotGitHub(HEAD_1);
    interceptInstallationRepo(github, (client) => ({
      ...client,
      postEntryComment() {
        throw new Error("comment write crashed");
      },
    }));

    await expect(
      makeTask({ github })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("comment write crashed");

    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(readLiveBodies(github)).toEqual([]);
  });

  it("replaces the on-demand body when an approved head then fails", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const github = makeGitHub(HEAD_1);
    await makeTask({ github })(payload);
    expect(readLiveBodies(github)).toEqual([ON_DEMAND_BODY]);
    await approveTrigger(pr);
    await createGenerationProjection(harness.handle, ctx).upsertPending(
      makeTarget(pr, HEAD_1),
    );
    refuseDiffs(github);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    const failedBody = buildEntryCommentFailedBody(
      t,
      { ...ENTRY_PR_VIEW, headIndex: FIRST_BRIEF_INDEX, headSha: HEAD_1 },
      GenerationFailureCodes.DIFF_TOO_LARGE,
    );
    expect(readLiveBodies(github)).toEqual([failedBody]);
  });

  it("swaps the on-demand body for the generating one once approved", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const github = makeGitHub(HEAD_1);
    await makeTask({ github })(payload);
    await approveTrigger(pr);
    await createGenerationProjection(harness.handle, ctx).upsertPending(
      makeTarget(pr, HEAD_1),
    );
    const generator = stubGenerator();
    generator.failNextWith = makeConnectionError();

    const run = makeTask({ github, generator })(payload, {
      job: FIRST_ATTEMPT,
    });
    await expect(run).rejects.toThrow("Connection error");

    const generatingBody = buildEntryCommentGeneratingBody(t, {
      ...ENTRY_PR_VIEW,
      headIndex: FIRST_BRIEF_INDEX,
      headSha: HEAD_1,
    });
    expect(readLiveBodies(github)).toEqual([generatingBody]);
  });

  it("leaves a head approved during a bot run's settings read", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeBotGitHub(HEAD_1);
    const generator = stubGenerator();
    const target = makeTarget(pr, HEAD_1);
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async fetchRepoFile(file) {
        const gen = createGenerationProjection(harness.handle, ctx);
        await gen.markAwaitingTrigger(target);
        await createIngestRoutines(harness.handle, ctx).triggerOnDemand({
          pullRequestId: pr.id,
          approverId: makeReviewerId(900n),
        });
        return client.fetchRepoFile(file);
      },
    }));

    await makeTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.PENDING);
    expect(generator.calls).toEqual([]);
    expect(listCommentCalls(github)).toEqual([]);
  });

  it("releases a held head whose PR was approved, posting nothing", async () => {
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    await approveTrigger(pr);
    const github = makeGitHub(HEAD_1);
    const generator = stubGenerator();
    await harness.raw("update graphile_worker.jobs set locked_at = now()");
    const jobsBefore = await countGenerateJobs();

    await makeTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.PENDING);
    expect(await countGenerateJobs()).toBe(jobsBefore + 1);
    expect(generator.calls).toEqual([]);
    expect(listCommentCalls(github)).toEqual([]);
  });

  it("generates a bot PR a collaborator approved", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await approveTrigger(pr);
    const github = makeBotGitHub(HEAD_1);
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    expect(generator.calls).toContain("brief");
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("never gates a url-box job for a bot PR", async () => {
    const ownerCtx = parseScopeContext({ ownerUserId: 555 });
    const grantId = await seedViewerGrant();
    const pr = await createTenantRepository(
      harness.handle,
      ownerCtx,
    ).pullRequests.upsert({
      repoId: makeRepoId(7n),
      prNumber: 7,
      repoSlug: "acme/widget",
      state: PrStates.OPEN,
    });
    await createGenerationProjection(harness.handle, ownerCtx).upsertPending(
      makeTarget(pr, HEAD_1),
    );
    const github = makeBotGitHub(HEAD_1);
    const generator = stubGenerator();

    await makeTask({ github, generator })({
      owner_user_id: "555",
      grant_id: String(grantId),
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    expect(generator.calls).toContain("brief");
    const brief = await createArtifactStore(
      harness.handle,
      ownerCtx,
    ).briefs.get(pr.id, BASE, HEAD_1);
    expect(brief).toBeDefined();
    expect(listCommentCalls(github)).toEqual([]);
  });

  it("never gates a recovery run over a lapsed claim", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const projection = createGenerationProjection(harness.handle, ctx);
    await claimTestRun(projection, makeTarget(pr, HEAD_1));
    await harness.raw("update graphile_worker.jobs set locked_at = now()");
    await harness.raw(
      "update generation set lease_expires_at = now() - interval '1 second'",
    );
    const github = makeBotGitHub(HEAD_1);
    const generator = stubGenerator();

    await makeRecoveryTask({ github, generator })(payload, {
      job: FIRST_ATTEMPT,
    });

    expect(generator.calls).toEqual(["brief"]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });
});
