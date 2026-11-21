import { describe, expect, it } from "vitest";
import type { PullRequestFile, PullRequestInfo } from "github";
import {
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  parseUnmetConditions,
  type PullRequestRow,
} from "persistence";
import { parseInstanceTriggerConditions } from "generators/trigger-conditions";
import {
  buildEntryCommentBody,
  buildEntryCommentClosedBody,
  buildEntryCommentGeneratingBody,
  buildEntryCommentHeldBody,
} from "../../src/task/entry-comment";
import { digestPathGlobs } from "../../src/task/generate/logic/condition-check/evaluate";
import {
  FakeFailures,
  type FakeGitHub,
  type FakeReview,
} from "github/testing";
import { createI18n } from "i18n";
import type { TFunction } from "i18next";
import { RepoConfigPaths } from "repo-config";
import { GenerationStatuses } from "types";
import { GenerationFailureCodes } from "types/generations";
import {
  addSettings,
  captureLogger,
  countStartedRuns,
  ctx,
  FIRST_ATTEMPT,
  harness,
  HEAD_1,
  HEAD_2,
  failFirstSettingsRead,
  interceptInstallationRepo,
  listCommentCalls,
  makeEntryLink,
  makeGitHub,
  makePullRequestInfo,
  makeLargePoolTask,
  makeReviewerId,
  makeTarget,
  makeSyncEntryTask,
  makeTask,
  type ReadCount,
  openPerTestHarness,
  PR_REF,
  readLiveBodies,
  readRowStatus,
  REPO,
  SECOND_ATTEMPT,
  SEEDED_ENTRY_ID,
  setUpHarness,
  SMALL_DIFF,
  stubGenerator,
  trackEntryBody,
  trigger,
} from "./helpers";
import { SETTINGS_READ_RETRY_DELAYS_MS } from "../../src/task/generate/logic/run-gates";

setUpHarness();

function makeInstanceConditions(block: unknown) {
  const parsed = parseInstanceTriggerConditions(block);
  if (!parsed.ok) {
    throw new Error(parsed.error.issues.join("; "));
  }
  return parsed.value;
}

/** Fails the first PR read the run makes once it claimed the row: the generating post's head read. */
function failFirstRunningHeadRead(github: FakeGitHub, pr: PullRequestRow) {
  const refusing = makeGitHub(HEAD_1);
  refusing.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
  const refusingRepo = refusing
    .bindInstallationGitHub(ctx.installationId)
    .forRepo(PR_REF);
  const projection = createGenerationProjection(harness.handle, ctx);
  let failed = false;
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async fetchPullRequest(prNumber) {
      const row = await projection.get(makeTarget(pr, HEAD_1));
      const running = row?.status === GenerationStatuses.RUNNING;
      if (running && !failed) {
        failed = true;
        return refusingRepo.fetchPullRequest(prNumber);
      }
      return client.fetchPullRequest(prNumber);
    },
  }));
}

/** The first diff read fails transiently; every later one is served. */
function failFirstDiffRead(github: FakeGitHub) {
  const refusing = makeGitHub(HEAD_1);
  refusing.failOn("fetchDiff", FakeFailures.SERVER_ERROR);
  const refusingRepo = refusing
    .bindInstallationGitHub(ctx.installationId)
    .forRepo(PR_REF);
  let failed = false;
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async fetchDiff(prNumber) {
      if (!failed) {
        failed = true;
        return refusingRepo.fetchDiff(prNumber);
      }
      return client.fetchDiff(prNumber);
    },
  }));
}

function listEntryWrites(github: FakeGitHub, before: number): string[] {
  return listCommentCalls(github)
    .slice(before)
    .filter((call) => !call.startsWith("fetch"));
}

const CODERABBIT_APP_ID = 347_564n;

const PATHS_SETTINGS = "version: 1\ntriggerConditions:\n  paths: ['**/*.ts']\n";
const PATHS_OR_LABELS_SETTINGS = `version: 1
triggerConditions:
  any:
    paths: ['src/payments/**']
    labels: [needs-brief]
`;

/** One file past the hunk limit a single call takes, so the run routes. */
const MULTI_CALL_FILES = 121;
const PAYMENTS_PATHS_SETTINGS =
  "version: 1\ntriggerConditions:\n  paths: ['src/payments/**']\n";
const PAST_FILE_LIST_COUNT = 3001;

const REVIEW_REQUESTED_SETTINGS =
  "version: 1\ntriggerConditions:\n  reviewRequested: on\n";
const REVIEW_REQUESTED_OR_LABELS_SETTINGS = `version: 1
triggerConditions:
  any:
    reviewRequested: on
    labels: [needs-brief]
`;
const PAYMENTS_GLOBS = ["src/payments/**"];
const REFUSE_REVIEW_STAMP_SQL = [
  `create function refuse_review_stamp() returns trigger language plpgsql as $$
begin
  raise exception 'stamp refused';
end $$`,
  `create trigger refuse_review_stamp before update of review_requested_met_at
  on pull_request for each row execute function refuse_review_stamp()`,
];

function makeReview(author: Partial<FakeReview>): FakeReview {
  return {
    reviewId: 501n,
    reviewNodeId: "PRR_501",
    state: "COMMENTED",
    body: "",
    ...author,
  };
}

function readPullRequest(pr: PullRequestRow) {
  return createTenantRepository(harness.handle, ctx).pullRequests.getById(
    pr.id,
  );
}

function countReviewReads(github: ReturnType<typeof makeGitHub>): number {
  return github.listCalls("listSubmittedReviews").length;
}

function makeDocsOnlyGitHub() {
  return makeGitHub(HEAD_1, [
    { path: "docs/guide.md", additions: 3, deletions: 1 },
  ]);
}

async function listJobTasks(): Promise<unknown[]> {
  const jobs = await harness.raw(
    "select task_identifier from graphile_worker.jobs order by id",
  );
  return jobs.map((job) => job["task_identifier"]);
}

function countFileListReads(github: ReturnType<typeof makeGitHub>): number {
  return github.listCalls("fetchPullRequestFiles").length;
}

async function readUnmet(pr: PullRequestRow) {
  const row = await createGenerationProjection(harness.handle, ctx).get(
    makeTarget(pr, HEAD_1),
  );
  return parseUnmetConditions(row?.unmetConditions ?? null)?.conditions;
}

const SETTINGS_READS_PER_RUN = SETTINGS_READ_RETRY_DELAYS_MS.length + 1;
const BURST_PR_NUMBER = 8;

/** Counts the run's `settings.yaml` reads, calling `onRead` before each. */
function countSettingsReads(
  github: FakeGitHub,
  onRead: () => Promise<void> = async () => {},
): ReadCount {
  const reads: ReadCount = { count: 0 };
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async fetchRepoFile(input) {
      if (input.path === RepoConfigPaths.SETTINGS) {
        reads.count += 1;
        await onRead();
      }
      return client.fetchRepoFile(input);
    },
  }));
  return reads;
}

describe("generate task, trigger conditions", () => {
  it("holds a draft under the instance's readyForReview with no claim", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const generator = stubGenerator();

    await makeTask({
      github,
      generator,
      triggerConditions: makeInstanceConditions({ readyForReview: "on" }),
    })(payload);

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      { kind: "ready-for-review", setBy: "instance" },
    ]);
    expect(await countStartedRuns()).toBe(0);
  });

  it("reads the repo's conditions when a settings read clears in the run", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions:\n  never: on\n");
    const failing = makeGitHub(HEAD_1);
    failing.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    const reads = failFirstSettingsRead(github, failing);

    await makeTask({ github })(payload, { job: FIRST_ATTEMPT });

    expect(reads.count).toBe(2);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([{ kind: "never", setBy: "repo" }]);
  });

  it("holds on the instance's conditions when every read in the run fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    const statuses: (string | undefined)[] = [];
    const reads = countSettingsReads(github, async () => {
      statuses.push(await readRowStatus(pr, HEAD_1));
    });

    await makeTask({
      github,
      triggerConditions: makeInstanceConditions({ readyForReview: "on" }),
    })(payload, { job: FIRST_ATTEMPT });

    expect(reads.count).toBe(SETTINGS_READS_PER_RUN);
    expect(statuses).not.toContain(GenerationStatuses.FAILED);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      { kind: "ready-for-review", setBy: "instance" },
    ]);
  });

  it("generates a held draft on its next run once it is ready", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    await makeTask({ github, triggerConditions: readyForReview })(payload);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);

    github.updatePullRequest(PR_REF, { draft: false });
    await makeTask({ github, triggerConditions: readyForReview })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(await readUnmet(pr)).toBeUndefined();
  });

  it("caps a burst of released held heads past the day's cap", async () => {
    const github = makeGitHub(HEAD_1);
    const prNumbers = [PR_REF.prNumber, BURST_PR_NUMBER, BURST_PR_NUMBER + 1];
    for (const prNumber of prNumbers.slice(1)) {
      github.addPullRequest(
        { ...PR_REF, prNumber },
        { info: makePullRequestInfo(HEAD_1), files: [], diff: SMALL_DIFF },
      );
    }
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    const jobs = [];
    for (const prNumber of prNumbers) {
      github.updatePullRequest({ ...PR_REF, prNumber }, { draft: true });
      const job = await trigger(HEAD_1, { prNumber });
      await makeTask({ github, triggerConditions: readyForReview })(
        job.payload,
      );
      expect(await readRowStatus(job.pr, HEAD_1)).toBe(GenerationStatuses.HELD);
      jobs.push(job);
    }

    const generator = stubGenerator();
    const spend = { maxGenerationsPerDay: 1 };
    for (const prNumber of prNumbers) {
      github.updatePullRequest({ ...PR_REF, prNumber }, { draft: false });
    }
    for (const { payload } of jobs) {
      await makeTask({
        github,
        generator,
        spend,
        triggerConditions: readyForReview,
      })(payload);
    }

    const statuses = await Promise.all(
      jobs.map(({ pr }) => readRowStatus(pr, HEAD_1)),
    );
    expect(statuses).toEqual([
      GenerationStatuses.SUCCEEDED,
      GenerationStatuses.CAPPED,
      GenerationStatuses.CAPPED,
    ]);
    expect(await countStartedRuns()).toBe(1);
  });

  it("generates a ready pull request under readyForReview", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();

    await makeTask({
      generator,
      triggerConditions: makeInstanceConditions({ readyForReview: "on" }),
    })(payload);

    expect(generator.calls.length).toBeGreaterThan(0);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("holds on the repo's own never, naming the repository", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions:\n  never: on\n");

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([{ kind: "never", setBy: "repo" }]);
  });

  it("generates when the repo switches the instance's conditions off", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions: off\n");

    await makeTask({
      github,
      triggerConditions: makeInstanceConditions({ never: "on" }),
    })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("generates a head a Generate click released, skipping the conditions", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const never = makeInstanceConditions({ never: "on" });
    await makeTask({ triggerConditions: never })(payload);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);

    await createIngestRoutines(harness.handle, ctx).triggerOnDemand({
      pullRequestId: pr.id,
      approverId: makeReviewerId(900n),
    });
    const released = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'generate' order by id desc limit 1",
    );
    const releasedPayload = released[0]?.["payload"];
    await makeTask({ triggerConditions: never })(releasedPayload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("generates a never-held PR that generates on every push", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createIngestRoutines(harness.handle, ctx).turnOnGenerateEveryPush({
      pullRequestId: pr.id,
      userId: makeReviewerId(900n),
    });
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions:\n  never: on\n");
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    expect(generator.calls.length).toBeGreaterThan(0);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("holds the next push again once every push is turned off", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const routines = createIngestRoutines(harness.handle, ctx);
    await routines.turnOnGenerateEveryPush({
      pullRequestId: pr.id,
      userId: makeReviewerId(900n),
    });
    await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.turnOffGenerateEveryPush(pr.id);

    await makeTask({
      triggerConditions: makeInstanceConditions({ never: "on" }),
    })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
  });

  it("generates a head whose PR turned on every push during the check", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeDocsOnlyGitHub();
    addSettings(github, PATHS_SETTINGS);
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async fetchPullRequestFiles(prNumber) {
        const files = await client.fetchPullRequestFiles(prNumber);
        await createIngestRoutines(harness.handle, ctx).turnOnGenerateEveryPush(
          {
            pullRequestId: pr.id,
            userId: makeReviewerId(900n),
          },
        );
        return files;
      },
    }));

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("posts the held Entry once and leaves it when nothing changed", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    await makeTask({ github, triggerConditions: readyForReview })(payload);

    const [held] = readLiveBodies(github);
    expect(held).toContain("**No brief for `aaaaaaa`.**");
    expect(held).toContain(
      "- Needs this pull request marked ready for review (this MergeBrief instance's setting)",
    );
    const before = listCommentCalls(github).length;

    await makeTask({ github, triggerConditions: readyForReview })(payload);

    const writes = listCommentCalls(github)
      .slice(before)
      .filter((call) => !call.startsWith("fetch"));
    expect(writes).toEqual([]);
  });

  it.each([
    [
      "another head's held body",
      (t: TFunction) =>
        buildEntryCommentHeldBody(t, {
          next: makeEntryLink(HEAD_2),
          previous: undefined,
          unmet: [{ kind: "never", setBy: "repo" }],
        }),
    ],
    [
      "a held body for other conditions",
      (t: TFunction) =>
        buildEntryCommentHeldBody(t, {
          next: makeEntryLink(HEAD_1),
          previous: undefined,
          unmet: [{ kind: "never", setBy: "repo" }],
        }),
    ],
    [
      "another head's ready body",
      (t: TFunction) => buildEntryCommentBody(t, makeEntryLink(HEAD_2)),
    ],
    [
      "another head's generating body",
      (t: TFunction) =>
        buildEntryCommentGeneratingBody(t, makeEntryLink(HEAD_2)),
    ],
  ])("edits %s in place into the held body", async (_case, buildBody) => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    await trackEntryBody(github, pr.id, buildBody(createI18n().t));
    const before = listCommentCalls(github).length;

    await makeTask({
      github,
      triggerConditions: makeInstanceConditions({ readyForReview: "on" }),
    })(payload);

    expect(listEntryWrites(github, before)).toEqual([
      `edit:${SEEDED_ENTRY_ID}`,
    ]);
    const [held] = readLiveBodies(github);
    expect(held).toContain("**No brief for `aaaaaaa`.**");
  });

  it("edits a held push's Entry in place when the next push is held too", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    await makeTask({ github, triggerConditions: readyForReview })(
      first.payload,
    );
    const [entryId] = github.readComments(REPO).keys();
    const before = listCommentCalls(github).length;

    const second = await trigger(HEAD_2);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    await makeTask({ github, triggerConditions: readyForReview })(
      second.payload,
    );

    expect(listEntryWrites(github, before)).toEqual([`edit:${entryId}`]);
    const [held] = readLiveBodies(github);
    expect(held).toContain("**No brief for `bbbbbbb`.**");
  });

  it("queues the newer head's sync when its held body lands under ours", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const earlier = buildEntryCommentGeneratingBody(
      createI18n().t,
      makeEntryLink(HEAD_1),
    );
    await trackEntryBody(github, first.pr.id, earlier);
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    let interleaved = false;
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async editComment(commentId, body) {
        if (!interleaved) {
          interleaved = true;
          github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
          const second = await trigger(HEAD_2);
          await makeTask({ github, triggerConditions: readyForReview })(
            second.payload,
          );
        }
        return client.editComment(commentId, body);
      },
    }));

    await makeTask({ github, triggerConditions: readyForReview })(
      first.payload,
    );

    const syncs = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'sync-entry'",
    );
    const syncHeads = syncs.map(
      (job) => (job["payload"] as { head_sha: string }).head_sha,
    );
    expect(syncHeads).toEqual([HEAD_2]);
    expect(readLiveBodies(github)[0]).toContain("**No brief for `aaaaaaa`.**");
    await makeSyncEntryTask({ github })(syncs[0]?.["payload"]);
    const [held] = readLiveBodies(github);
    expect(held).toContain("**No brief for `bbbbbbb`.**");
  });

  it("leaves an unmarked Entry comment on the run and on the sync", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const unmarked = "A comment someone rewrote without the marker.";
    await trackEntryBody(github, pr.id, unmarked);
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });

    await makeTask({ github, triggerConditions: readyForReview })(payload);

    expect(readLiveBodies(github)).toEqual([unmarked]);
    const syncs = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'sync-entry'",
    );
    await makeSyncEntryTask({ github })(syncs[0]?.["payload"]);

    expect(syncs).toHaveLength(1);
    expect(readLiveBodies(github)).toEqual([unmarked]);
  });

  it("leaves a closed body to the Entry sync, which reads the PR fresh", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const closed = buildEntryCommentClosedBody(createI18n().t, HEAD_1);
    await trackEntryBody(github, pr.id, closed);
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });

    await makeTask({ github, triggerConditions: readyForReview })(payload);

    expect(readLiveBodies(github)).toEqual([closed]);
    const syncs = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'sync-entry'",
    );
    expect(syncs).toHaveLength(1);

    await makeSyncEntryTask({ github })(syncs[0]?.["payload"]);

    const [held] = readLiveBodies(github);
    expect(held).toContain("**No brief for `aaaaaaa`.**");
  });

  it("edits a released hold's Entry to generating, then pings once", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    await makeTask({ github, triggerConditions: readyForReview })(payload);
    const before = listCommentCalls(github).length;

    github.updatePullRequest(PR_REF, { draft: false });
    await makeTask({ github, triggerConditions: readyForReview })(payload);

    const writes = listCommentCalls(github)
      .slice(before)
      .filter((call) => !call.startsWith("fetch"));
    expect(writes[0]).toMatch(/^edit:/);
    expect(writes.filter((call) => call === "post")).toHaveLength(1);
    const [ready] = readLiveBodies(github);
    expect(ready).toContain("mergebrief-entry-kind: ready");
  });

  it("edits a held Entry a Generate click released, then pings once", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    await makeTask({ github, triggerConditions: readyForReview })(payload);
    const before = listCommentCalls(github).length;

    await createIngestRoutines(harness.handle, ctx).triggerOnDemand({
      pullRequestId: pr.id,
      approverId: makeReviewerId(900n),
    });
    const stamped = await harness.raw(
      "select generate_requested_at from generation where status = 'pending'",
    );
    expect(stamped[0]?.["generate_requested_at"]).not.toBeNull();
    await makeTask({ github, triggerConditions: readyForReview })(payload);

    const writes = listEntryWrites(github, before);
    expect(writes[0]).toMatch(/^edit:/);
    expect(writes.filter((call) => call === "post")).toHaveLength(1);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("edits a released hold's Entry on the retry after a failed attempt", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    await makeTask({ github, triggerConditions: readyForReview })(payload);
    const before = listCommentCalls(github).length;

    github.updatePullRequest(PR_REF, { draft: false });
    failFirstDiffRead(github);
    const task = makeTask({ github, triggerConditions: readyForReview });
    await expect(task(payload, { job: FIRST_ATTEMPT })).rejects.toThrow("502");
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(listEntryWrites(github, before)).toEqual([]);
    await task(payload, { job: SECOND_ATTEMPT });

    const writes = listEntryWrites(github, before);
    expect(writes[0]).toMatch(/^edit:/);
    expect(writes.filter((call) => call === "post")).toHaveLength(1);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("edits a released hold's Entry even when its head read fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    await makeTask({ github, triggerConditions: readyForReview })(payload);
    const before = listCommentCalls(github).length;

    github.updatePullRequest(PR_REF, { draft: false });
    failFirstRunningHeadRead(github, pr);
    await makeTask({ github, triggerConditions: readyForReview })(payload);

    const writes = listEntryWrites(github, before);
    expect(writes[0]).toMatch(/^edit:/);
    expect(writes.filter((call) => call === "post")).toHaveLength(1);
    const [ready] = readLiveBodies(github);
    expect(ready).toContain("mergebrief-entry-kind: ready");
  });

  it.each<{
    readonly kind: string;
    readonly block: Record<string, unknown>;
    readonly held: Partial<PullRequestInfo>;
    readonly released: Partial<PullRequestInfo>;
    readonly unmet: Record<string, unknown>;
  }>([
    {
      kind: "size",
      block: { size: { changedLines: { max: 5 } } },
      held: { additions: 8, deletions: 2 },
      released: { additions: 4, deletions: 1 },
      unmet: {
        kind: "size",
        setBy: "instance",
        measure: "changed-lines",
        side: "max",
        limit: 5,
        actual: 10,
      },
    },
    {
      kind: "labels",
      block: { labels: ["needs-brief"] },
      held: { labels: ["bug"] },
      released: { labels: ["bug", "Needs-Brief"] },
      unmet: { kind: "labels", setBy: "instance", labels: ["needs-brief"] },
    },
    {
      kind: "titleKeywords",
      block: { titleKeywords: ["brief"] },
      held: { title: "Debriefing notes" },
      released: { title: "Brief: debriefing notes" },
      unmet: {
        kind: "title-keywords",
        setBy: "instance",
        keywords: ["brief"],
      },
    },
    {
      kind: "baseBranches",
      block: { baseBranches: ["main"] },
      held: { baseRef: "feature/parent" },
      released: { baseRef: "main" },
      unmet: {
        kind: "base-branches",
        setBy: "instance",
        base: "feature/parent",
        branches: ["main"],
      },
    },
    {
      kind: "reviewRequested",
      block: { reviewRequested: "on" },
      held: { pendingReviewRequests: 0 },
      released: { pendingReviewRequests: 1 },
      unmet: { kind: "review-requested", setBy: "instance" },
    },
  ])("holds on $kind, then generates once the fact changes", async (row) => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, row.held);
    const conditions = makeInstanceConditions(row.block);
    const generator = stubGenerator();
    await makeTask({ github, generator, triggerConditions: conditions })(
      payload,
    );

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([row.unmet]);

    github.updatePullRequest(PR_REF, row.released);
    await makeTask({ github, triggerConditions: conditions })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("holds on a repo paths condition no changed file matches", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeDocsOnlyGitHub();
    addSettings(github, PATHS_SETTINGS);
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      { kind: "paths", setBy: "repo", paths: ["**/*.ts"] },
    ]);
    expect(await countStartedRuns()).toBe(0);
  });

  it("generates a held head once a changed file matches the paths", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const held = makeDocsOnlyGitHub();
    addSettings(held, PATHS_SETTINGS);
    await makeTask({ github: held })(payload);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);

    const matching = makeGitHub(HEAD_1);
    addSettings(matching, PATHS_SETTINGS);
    await makeTask({ github: matching })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("reads the file list once in a run with a paths condition", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, PATHS_SETTINGS);
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    expect(generator.calls).toContain("brief");
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(countFileListReads(github)).toBe(1);
  });

  it("reads the file list once across the hop to the large pool", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: MULTI_CALL_FILES });
    addSettings(github, PATHS_SETTINGS);

    await makeTask({ github })(payload);
    expect(countFileListReads(github)).toBe(0);
    await makeLargePoolTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(countFileListReads(github)).toBe(1);
  });

  it("holds a multi-call head in the large pool when no file matches", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeDocsOnlyGitHub();
    github.updatePullRequest(PR_REF, { changedFiles: MULTI_CALL_FILES });
    addSettings(github, PATHS_SETTINGS);
    const generator = stubGenerator();
    await harness.raw("update graphile_worker.jobs set locked_at = now()");

    await makeTask({ github, generator })(payload);
    expect(await listJobTasks()).toEqual(["generate", "generate-large"]);
    expect(countFileListReads(github)).toBe(0);
    await makeLargePoolTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      { kind: "paths", setBy: "repo", paths: ["**/*.ts"] },
    ]);
    expect(generator.calls).toEqual([]);
    expect(await countStartedRuns()).toBe(0);
  });

  it("reads no file list to hold a head without a paths condition", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions:\n  never: on\n");

    await makeTask({ github })(payload);

    expect(countFileListReads(github)).toBe(0);
  });

  it("reads no file list while another condition holds the head", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(
      github,
      "version: 1\ntriggerConditions:\n  paths: ['**/*.ts']\n  labels: [needs-brief]\n",
    );

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      { kind: "labels", setBy: "repo", labels: ["needs-brief"] },
    ]);
    expect(countFileListReads(github)).toBe(0);
  });

  it("reads no file list while a failing ci member holds an any group", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(
      github,
      "version: 1\ntriggerConditions:\n  paths: ['**/*.ts']\n  any:\n    ci: { checks: [build] }\n    labels: [needs-brief]\n",
    );
    github.addCheckRun(REPO, HEAD_1, {
      checkRunId: 1n,
      name: "build",
      completed: true,
      conclusion: "failure",
    });

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(countFileListReads(github)).toBe(0);
  });

  it.each<[string, PullRequestFile]>([
    [
      "a rename out of the watched folder",
      {
        path: "archive/refund.ts",
        previousPath: "src/payments/refund.ts",
        additions: 0,
        deletions: 0,
      },
    ],
    [
      "a rename into the watched folder",
      {
        path: "src/payments/refund.ts",
        previousPath: "lib/refund.ts",
        additions: 0,
        deletions: 0,
      },
    ],
    [
      "a deletion inside the watched folder",
      { path: "src/payments/legacy.ts", additions: 0, deletions: 12 },
    ],
  ])("generates on %s", async (_case, file) => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1, [file]);
    addSettings(github, PAYMENTS_PATHS_SETTINGS);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("holds a PR past GitHub's file list when no listed file matches", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeDocsOnlyGitHub();
    github.updatePullRequest(PR_REF, { changedFiles: PAST_FILE_LIST_COUNT });
    addSettings(github, PATHS_SETTINGS);

    await makeLargePoolTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      { kind: "paths", setBy: "repo", paths: ["**/*.ts"] },
    ]);
    expect(countFileListReads(github)).toBe(1);
  });

  it("passes a PR past GitHub's file list on a listed match", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: PAST_FILE_LIST_COUNT });
    addSettings(github, PATHS_SETTINGS);

    await makeLargePoolTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).not.toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toBeUndefined();
    expect(countFileListReads(github)).toBe(1);
  });

  it("holds an any group past GitHub's file list with no listed match", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeDocsOnlyGitHub();
    github.updatePullRequest(PR_REF, { changedFiles: PAST_FILE_LIST_COUNT });
    addSettings(github, PATHS_OR_LABELS_SETTINGS);

    await makeLargePoolTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      {
        kind: "any",
        conditions: [
          { kind: "paths", setBy: "repo", paths: ["src/payments/**"] },
          { kind: "labels", setBy: "repo", labels: ["needs-brief"] },
        ],
      },
    ]);
    expect(countFileListReads(github)).toBe(1);
  });

  it("stamps the paths digest when a changed file matches", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1, [
      { path: "src/payments/refund.ts", additions: 4, deletions: 0 },
    ]);
    addSettings(github, PAYMENTS_PATHS_SETTINGS);

    await makeTask({ github })(payload);

    const row = await readPullRequest(pr);
    expect(row?.pathsMetDigest).toBe(digestPathGlobs(PAYMENTS_GLOBS));
    expect(row?.pathsMetAt).toBeInstanceOf(Date);
  });

  it("meets paths from its stamp after the file was reverted", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.stampPathsMet(pr.id, digestPathGlobs(PAYMENTS_GLOBS));
    const github = makeDocsOnlyGitHub();
    addSettings(github, PAYMENTS_PATHS_SETTINGS);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(countFileListReads(github)).toBe(1);
  });

  it("reads no file list in the check when the stamp meets paths", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.stampPathsMet(pr.id, digestPathGlobs(PAYMENTS_GLOBS));
    const github = makeDocsOnlyGitHub();
    addSettings(github, PAYMENTS_PATHS_SETTINGS);
    github.failOn("fetchPullRequestFiles", FakeFailures.SERVER_ERROR);

    await expect(
      makeTask({ github })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("502");

    expect(await countStartedRuns()).toBe(1);
    expect(countFileListReads(github)).toBe(1);
  });

  it("checks paths again once the repo edits its globs", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.stampPathsMet(pr.id, digestPathGlobs(["docs/**"]));
    const github = makeDocsOnlyGitHub();
    addSettings(github, PAYMENTS_PATHS_SETTINGS);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(countFileListReads(github)).toBe(1);
  });

  it("holds an any group of paths and labels until a label lands", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, PATHS_OR_LABELS_SETTINGS);
    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      {
        kind: "any",
        conditions: [
          { kind: "paths", setBy: "repo", paths: ["src/payments/**"] },
          { kind: "labels", setBy: "repo", labels: ["needs-brief"] },
        ],
      },
    ]);

    github.updatePullRequest(PR_REF, { labels: ["needs-brief"] });
    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(countFileListReads(github)).toBe(2);
  });

  it("retries a paths check whose file list read fails transiently", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeDocsOnlyGitHub();
    addSettings(github, PATHS_SETTINGS);
    github.failOn("fetchPullRequestFiles", FakeFailures.SERVER_ERROR);
    const generator = stubGenerator();

    await expect(
      makeTask({ github, generator })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("502");

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.GITHUB_UNAVAILABLE);
    expect(row?.runId).toBeNull();
    expect(await readUnmet(pr)).toBeUndefined();
    expect(generator.calls).toEqual([]);
    expect(await countStartedRuns()).toBe(0);
  });

  it("holds on a bot still running, then generates once its run completes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const botsCondition = makeInstanceConditions({
      bots: { coderabbit: "finished" },
    });
    github.addCheckRun(REPO, HEAD_1, {
      checkRunId: 1n,
      name: "CodeRabbit",
      appId: CODERABBIT_APP_ID,
      completed: false,
    });
    const generator = stubGenerator();

    await makeTask({ github, generator, triggerConditions: botsCondition })(
      payload,
    );

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      {
        kind: "bots",
        setBy: "instance",
        bot: "coderabbit",
        verdict: "finished",
        state: "running",
      },
    ]);

    github.addCheckRun(REPO, HEAD_1, {
      checkRunId: 2n,
      name: "CodeRabbit",
      appId: CODERABBIT_APP_ID,
      completed: true,
      conclusion: "success",
    });
    await makeTask({ github, triggerConditions: botsCondition })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("holds on a failed required check from the base's rulesets", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions:\n  ci: required\n");
    github.setRequiredStatusChecks(REPO, "main", ["build", "lint"]);
    github.addCheckRun(REPO, HEAD_1, {
      checkRunId: 1n,
      name: "build",
      completed: true,
      conclusion: "failure",
    });
    github.addCommitStatus(REPO, HEAD_1, { context: "lint", state: "success" });

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      {
        kind: "ci",
        setBy: "repo",
        failed: ["build"],
        running: [],
        missing: [],
        permissionMissing: false,
      },
    ]);
    expect(github.listCalls("listRequiredStatusChecks")).toHaveLength(1);
  });

  it("holds on a missing permission when the check-run read is refused", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.failOn("listCheckRuns", FakeFailures.FORBIDDEN);
    const generator = stubGenerator();

    await makeTask({
      github,
      generator,
      triggerConditions: makeInstanceConditions({
        bots: { claude: "clean" },
        ci: { checks: ["build"] },
      }),
    })(payload);

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      {
        kind: "bots",
        setBy: "instance",
        bot: "claude",
        verdict: "clean",
        state: "permission-missing",
      },
      {
        kind: "ci",
        setBy: "instance",
        failed: [],
        running: [],
        missing: ["build"],
        permissionMissing: true,
      },
    ]);
  });

  it("stamps the PR when a pending review request meets it", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { pendingReviewRequests: 1 });
    addSettings(github, REVIEW_REQUESTED_SETTINGS);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect((await readPullRequest(pr))?.reviewRequestedMetAt).toBeInstanceOf(
      Date,
    );
    expect(countReviewReads(github)).toBe(0);
  });

  it("generates and warns when the review stamp write fails", async () => {
    await openPerTestHarness();
    for (const statement of REFUSE_REVIEW_STAMP_SQL) {
      await harness.raw(statement);
    }
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { pendingReviewRequests: 1 });
    addSettings(github, REVIEW_REQUESTED_SETTINGS);
    const { logger, readLines } = captureLogger();

    await makeTask({ github, log: logger })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    const messages = readLines().map((line) => line["msg"]);
    expect(messages).toContain("generate: condition stamp write failed");
  });

  it("meets reviewRequested from its stamp after GitHub dropped it", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.stampReviewRequestedMet(pr.id);
    const github = makeGitHub(HEAD_1);
    addSettings(github, REVIEW_REQUESTED_SETTINGS);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(countReviewReads(github)).toBe(0);
  });

  it("meets reviewRequested on a person's review with no stamp", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.addReview(
      PR_REF,
      makeReview({ authorLogin: "bob", authorType: "User" }),
    );
    addSettings(github, REVIEW_REQUESTED_SETTINGS);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect((await readPullRequest(pr))?.reviewRequestedMetAt).toBeInstanceOf(
      Date,
    );
  });

  it("holds reviewRequested when only a bot reviewed", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.addReview(
      PR_REF,
      makeReview({ authorLogin: "copilot", authorType: "Bot" }),
    );
    addSettings(github, REVIEW_REQUESTED_SETTINGS);

    await makeTask({ github })(payload);

    expect(await readUnmet(pr)).toEqual([
      { kind: "review-requested", setBy: "repo" },
    ]);
    expect((await readPullRequest(pr))?.reviewRequestedMetAt).toBeNull();
    expect(countReviewReads(github)).toBe(1);
  });

  it("meets an any group on a stamped review request alone", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.stampReviewRequestedMet(pr.id);
    const github = makeGitHub(HEAD_1);
    addSettings(github, REVIEW_REQUESTED_OR_LABELS_SETTINGS);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("reads no check runs, statuses or reviews without bots or ci", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);

    await makeTask({
      github,
      triggerConditions: makeInstanceConditions({ readyForReview: "on" }),
    })(payload);

    const reads = [
      ...github.listCalls("listCheckRuns"),
      ...github.listCalls("listCommitStatuses"),
      ...github.listCalls("listSubmittedReviews"),
      ...github.listCalls("listRequiredStatusChecks"),
    ];
    expect(reads).toEqual([]);
  });

  it("reads only reviews for a bots condition naming Copilot alone", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);

    await makeTask({
      github,
      triggerConditions: makeInstanceConditions({
        bots: { copilot: "finished" },
      }),
    })(payload);

    const reports = [
      ...github.listCalls("listCheckRuns"),
      ...github.listCalls("listCommitStatuses"),
    ];
    expect(reports).toEqual([]);
    expect(github.listCalls("listSubmittedReviews")).toHaveLength(1);
  });

  it("retries a bots check whose status read fails transiently", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.failOn("listCommitStatuses", FakeFailures.SERVER_ERROR);
    const generator = stubGenerator();

    await expect(
      makeTask({
        github,
        generator,
        triggerConditions: makeInstanceConditions({
          bots: { unblocked: "finished" },
        }),
      })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("502");

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.errorCode).toBe(GenerationFailureCodes.GITHUB_UNAVAILABLE);
    expect(await readUnmet(pr)).toBeUndefined();
    expect(generator.calls).toEqual([]);
  });
});
