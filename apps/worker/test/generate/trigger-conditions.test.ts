import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createIngestRoutines,
  parseUnmetConditions,
  type PullRequestRow,
} from "persistence";
import { parseInstanceTriggerConditions } from "generators/trigger-conditions";
import { buildEntryCommentClosedBody } from "../../src/task/entry-comment";
import { FakeFailures, type FakeGitHub } from "github/testing";
import { createI18n } from "i18n";
import { RepoConfigPaths } from "repo-config";
import { GenerationStatuses } from "types";
import {
  addSettings,
  countStartedRuns,
  ctx,
  FIRST_ATTEMPT,
  harness,
  HEAD_1,
  failFirstSettingsRead,
  interceptInstallationRepo,
  listCommentCalls,
  makeGitHub,
  makePullRequestInfo,
  makeReviewerId,
  makeTarget,
  makeSyncEntryTask,
  makeTask,
  type ReadCount,
  PR_REF,
  readLiveBodies,
  readRowStatus,
  REPO,
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
    const messages = parsed.error.map((issue) => issue.message);
    throw new Error(messages.join("; "));
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

function listEntryWrites(github: FakeGitHub, before: number): string[] {
  return listCommentCalls(github)
    .slice(before)
    .filter((call) => !call.startsWith("fetch"));
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
});
