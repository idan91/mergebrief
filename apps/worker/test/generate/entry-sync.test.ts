import { describe, expect, it } from "vitest";
import { createI18n } from "i18n";
import {
  FAKE_APP_BOT_USER_ID,
  FakeFailures,
  type FakeGitHub,
} from "github/testing";
import {
  createIngestRoutines,
  createTenantRepository,
  ENTRY_SYNC_MAX_ATTEMPTS,
  type PullRequestRow,
} from "persistence";
import { RepoConfigPaths } from "repo-config";
import { GenerationStatuses } from "types/generations";
import {
  buildEntryCommentBody,
  buildEntryCommentClosedBody,
  buildEntryCommentGeneratingBody,
  formatEntryBodyToken,
} from "../../src/task/entry-comment";
import {
  EntryBodyKinds,
  type EntryBodyKind,
} from "../../src/task/entry-comment/types";
import { ENTRY_SYNC_DELAY_SECONDS } from "../../src/task/generate/consts";
import {
  captureLogger,
  ctx,
  FIRST_ATTEMPT,
  harness,
  HEAD_1,
  HEAD_2,
  interceptInstallationRepo,
  LAST_ATTEMPT,
  listCommentCalls,
  makeConnectionError,
  makeEntryLink,
  makeGitHub,
  makeRecoveryTask,
  makeSyncEntryTask,
  makeTask,
  PR_REF,
  readLiveBodies,
  readRowStatus,
  refuseDiffs,
  REPO,
  SECOND_ATTEMPT,
  setUpHarness,
  storeAnotherRunsEntry,
  stubGenerator,
  trackCappedEntry,
  trackEntryBody,
  trigger,
  type TaskOverrides,
  type TriggerOptions,
} from "./helpers";

setUpHarness();

const { t } = createI18n();
const EXHAUSTED_REASON = t("entryComment.failed.reason.attempts-exhausted");
const UNAVAILABLE_REASON = t("entryComment.failed.reason.provider-unavailable");
const CLOSED_HEADING = buildEntryCommentClosedBody(t, HEAD_1).split("\n")[0];
const READY_LINK = t("entryComment.ready.link");
const GENERATING_LINK = t("entryComment.generating.link");
const ON_DEMAND_HEADING = t("entryComment.onDemand.heading");
const ON_DEMAND_TOKEN = formatEntryBodyToken(EntryBodyKinds.ON_DEMAND);
const RETARGETED_BASE = "d".repeat(40);
const DELAY_BOUND_SECONDS = 5;

interface Outage {
  down: boolean;
}

/** Entry posts fail while `outage.down`; GitHub answers again once it clears. */
function failEntryPostsDuring(github: FakeGitHub): Outage {
  const outage: Outage = { down: true };
  const refusing = makeGitHub(HEAD_1);
  refusing.failOn("postEntryComment", FakeFailures.SERVER_ERROR);
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async postEntryComment(input) {
      if (outage.down) {
        const refused = refusing.bindInstallationGitHub(ctx.installationId);
        return refused.forRepo(PR_REF).postEntryComment(input);
      }
      return client.postEntryComment(input);
    },
  }));
  return outage;
}

async function readEntrySyncJobs(): Promise<Record<string, unknown>[]> {
  return harness.raw(
    "select id, key, payload, max_attempts, extract(epoch from (run_at - now()))::float8 as delay from graphile_worker.jobs where task_identifier = 'sync-entry' order by id",
  );
}

/** A first attempt fails transiently after posting the generating body. */
async function failFirstAttempt(
  github: FakeGitHub,
  payload: unknown,
): Promise<void> {
  const failing = stubGenerator();
  failing.failNextWith = makeConnectionError();
  await expect(
    makeTask({ github, generator: failing })(payload, { job: FIRST_ATTEMPT }),
  ).rejects.toThrow("Connection error");
}

/** The one sync job queued now. */
async function readQueuedEntrySync(): Promise<Record<string, unknown>> {
  const [job, ...others] = await readEntrySyncJobs();
  if (job === undefined || others.length > 0) {
    throw new Error("expected exactly one queued Entry sync");
  }
  return job;
}

/** Runs one queued sync as graphile does: locked while it runs, removed once it returns. */
async function runEntrySyncJob(
  job: Record<string, unknown>,
  overrides: TaskOverrides,
): Promise<void> {
  const params = [String(job["id"])];
  await harness.raw(
    "update graphile_worker.jobs set locked_at = now() where id = $1::bigint",
    params,
  );
  await makeSyncEntryTask(overrides)(job["payload"]);
  await harness.raw(
    "delete from graphile_worker.jobs where id = $1::bigint",
    params,
  );
}

const DRAIN_ROUNDS = 5;

/** Runs the queued syncs, then any they queue, until none is left or the rounds run out; answers how many ran. */
async function drainEntrySyncJobs(
  overrides: TaskOverrides,
  roundsLeft = DRAIN_ROUNDS,
): Promise<number> {
  const jobs = await readEntrySyncJobs();
  if (jobs.length === 0 || roundsLeft === 0) {
    return 0;
  }
  for (const job of jobs) {
    // oxlint-disable-next-line no-await-in-loop -- one key's syncs run one at a time, as graphile runs them
    await runEntrySyncJob(job, overrides);
  }
  const later = await drainEntrySyncJobs(overrides, roundsLeft - 1);
  return jobs.length + later;
}

async function readTrackedCommentId(
  pr: PullRequestRow,
): Promise<bigint | null | undefined> {
  const { pullRequests } = createTenantRepository(harness.handle, ctx);
  const row = await pullRequests.getById(pr.id);
  return row?.entryCommentId;
}

function listLiveCommentIds(github: FakeGitHub): bigint[] {
  return [...github.readComments(REPO).keys()];
}

/** Entry deletes fail while `outage.down`; GitHub answers again once it clears. */
function failEntryDeletesDuring(github: FakeGitHub): Outage {
  const outage: Outage = { down: true };
  const refusing = makeGitHub(HEAD_1);
  refusing.failOn("deleteComment", FakeFailures.SERVER_ERROR);
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async deleteComment(commentId) {
      if (outage.down) {
        const refused = refusing.bindInstallationGitHub(ctx.installationId);
        return refused.forRepo(PR_REF).deleteComment(commentId);
      }
      return client.deleteComment(commentId);
    },
  }));
  return outage;
}

interface Pause {
  /** Settles once the held call is waiting. */
  readonly reached: Promise<void>;
  /** Called from inside the held call: waits for `release`. */
  hold(): Promise<void>;
  release(): void;
}

function makePause(): Pause {
  let markReached = (): void => undefined;
  let markReleased = (): void => undefined;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    markReleased = resolve;
  });
  return {
    reached,
    async hold() {
      markReached();
      await released;
    },
    release: () => markReleased(),
  };
}

/** A last attempt fails while GitHub refuses deletes: its generating body outlives the failed post. */
async function failKeepingGeneratingBody(
  github: FakeGitHub,
  payload: unknown,
): Promise<void> {
  const outage = failEntryDeletesDuring(github);
  const failing = stubGenerator();
  failing.failNextWith = makeConnectionError();
  await expect(
    makeTask({ github, generator: failing })(payload, { job: LAST_ATTEMPT }),
  ).rejects.toThrow("Connection error");
  outage.down = false;
}

interface SameHeadRace {
  /** The sync planned the failed body and read the live generating one. */
  readonly syncRead: Pause;
  /** The rerun's ready post is about to delete the generating comment. */
  readonly readyDelete: Pause;
}

/**
 * The first comment read is the sync's and holds; the rerun's generating
 * refresh meets one more refused delete, so both writers start from the
 * same live comment. The ready post's delete holds when `holdsReadyDelete`.
 */
function interleaveSameHeadRace(
  github: FakeGitHub,
  holdsReadyDelete: boolean,
): SameHeadRace {
  const race = { syncRead: makePause(), readyDelete: makePause() };
  const refusing = makeGitHub(HEAD_1);
  refusing.failOn("deleteComment", FakeFailures.SERVER_ERROR);
  const refusingRepo = refusing
    .bindInstallationGitHub(ctx.installationId)
    .forRepo(PR_REF);
  let reads = 0;
  let deletes = 0;
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async fetchComment(commentId) {
      const fetched = await client.fetchComment(commentId);
      reads += 1;
      if (reads === 1) {
        await race.syncRead.hold();
      }
      return fetched;
    },
    async deleteComment(commentId) {
      deletes += 1;
      if (deletes === 1) {
        return refusingRepo.deleteComment(commentId);
      }
      if (deletes === 2 && holdsReadyDelete) {
        await race.readyDelete.hold();
      }
      return client.deleteComment(commentId);
    },
  }));
  return race;
}

const STALE_WINNER_ID = 9_201n;

/**
 * Another writer's swap lands inside the first post `isTarget` accepts: the
 * head's generating body takes the row, and every sync queued so far has
 * already run.
 */
function storeStaleWinnerOnPost(
  github: FakeGitHub,
  pr: PullRequestRow,
  headSha: string,
  isTarget: (body: string) => boolean,
): void {
  let stored = false;
  const winner = {
    id: STALE_WINNER_ID,
    body: buildEntryCommentGeneratingBody(t, makeEntryLink(headSha)),
  };
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async postEntryComment(input) {
      const posted = await client.postEntryComment(input);
      const interleaves = posted.ok && !stored && isTarget(input.body);
      if (interleaves) {
        stored = true;
        await harness.raw(
          "delete from graphile_worker.jobs where task_identifier = 'sync-entry'",
        );
        await storeAnotherRunsEntry(github, pr.id, winner);
      }
      return posted;
    },
  }));
}

/** After the brief's model call, GitHub fails the second PR read: the post's head read answers, its confirm read does not. */
function failConfirmReadAfterGenerating(
  github: FakeGitHub,
): NonNullable<TaskOverrides["generator"]> {
  const inner = stubGenerator();
  const refusing = makeGitHub(HEAD_1);
  refusing.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
  const refusingRepo = refusing
    .bindInstallationGitHub(ctx.installationId)
    .forRepo(PR_REF);
  let generated = false;
  let readsAfter = 0;
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async fetchPullRequest(prNumber) {
      if (generated) {
        readsAfter += 1;
      }
      if (readsAfter === 2) {
        return refusingRepo.fetchPullRequest(prNumber);
      }
      return client.fetchPullRequest(prNumber);
    },
  }));
  return {
    async generate(request) {
      const output = await inner.generate(request);
      generated = true;
      return output;
    },
    origin: (effort) => inner.origin(effort),
  };
}

/** Another writer's stale body wins the next swap, and the jobs table is gone while the swap's loser runs. */
function storeWinnerWithQueueOffline(
  github: FakeGitHub,
  pr: PullRequestRow,
): void {
  let stored = false;
  const winner = {
    id: STALE_WINNER_ID,
    body: buildEntryCommentGeneratingBody(t, makeEntryLink(HEAD_1)),
  };
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async postEntryComment(input) {
      const posted = await client.postEntryComment(input);
      if (posted.ok && !stored) {
        stored = true;
        await storeAnotherRunsEntry(github, pr.id, winner);
        await harness.raw(
          "alter table graphile_worker.jobs rename to jobs_offline",
        );
      }
      return posted;
    },
  }));
}

/** The PR merges while its brief generates, and the close sync swaps the generating body for the closed one. */
function mergeDuringGeneration(
  github: FakeGitHub,
  payload: unknown,
): NonNullable<TaskOverrides["generator"]> {
  const inner = stubGenerator();
  let merged = false;
  return {
    async generate(request) {
      if (!merged) {
        merged = true;
        github.updatePullRequest(PR_REF, { state: "closed", merged: true });
        await makeSyncEntryTask({ github })(payload);
      }
      return inner.generate(request);
    },
    origin: (effort) => inner.origin(effort),
  };
}

interface LostSwapCase {
  readonly writer: string;
  /** Leaves the head about to post; answers what the run needs. */
  arrange(github: FakeGitHub): Promise<LostSwapArrangement>;
  isTarget(body: string): boolean;
  /** Copy the converged body carries. */
  readonly expected: string;
}

interface LostSwapArrangement {
  readonly pr: PullRequestRow;
  readonly payload: unknown;
  readonly headSha: string;
  readonly overrides: TaskOverrides;
}

const CAPPED_LINE = "daily generation cap";
const FAILED_LINE = "generation failed";

const LOST_SWAP_CASES: readonly LostSwapCase[] = [
  {
    writer: "ready",
    async arrange() {
      const { pr, payload } = await trigger(HEAD_1);
      return { pr, payload, headSha: HEAD_1, overrides: {} };
    },
    isTarget: (body) => body.includes(READY_LINK),
    expected: READY_LINK,
  },
  {
    writer: "on-demand",
    async arrange() {
      const { pr, payload } = await trigger(HEAD_1, {
        requiresTriggerApproval: true,
      });
      return { pr, payload, headSha: HEAD_1, overrides: {} };
    },
    isTarget: (body) => body.includes(ON_DEMAND_TOKEN),
    expected: ON_DEMAND_TOKEN,
  },
  {
    writer: "capped",
    async arrange(github) {
      const { payload: briefedHead } = await trigger(HEAD_1);
      await makeTask({ github })(briefedHead);
      const { pr, payload } = await trigger(HEAD_2);
      github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
      const overrides = { spend: { maxGenerationsPerDay: 1 } };
      return { pr, payload, headSha: HEAD_2, overrides };
    },
    isTarget: (body) => body.includes(CAPPED_LINE),
    expected: CAPPED_LINE,
  },
  {
    writer: "failed",
    async arrange(github) {
      const { pr, payload } = await trigger(HEAD_1);
      refuseDiffs(github);
      return { pr, payload, headSha: HEAD_1, overrides: {} };
    },
    isTarget: (body) => body.includes(FAILED_LINE),
    expected: FAILED_LINE,
  },
];

interface OlderHeadCase {
  readonly terminal: string;
  readonly triggerOptions: TriggerOptions;
  readonly overrides: TaskOverrides;
  /** Copy the current head's body carries. */
  readonly carries: readonly string[];
}

const HEAD_2_SHORT_SHA = "`bbbbbbb`";

function isCarryingAll(body: string, carries: readonly string[]): boolean {
  return carries.every((copy) => body.includes(copy));
}
const SECOND_BRIEF_REV = "rev=2";

const OLDER_HEAD_CASES: readonly OlderHeadCase[] = [
  {
    terminal: "ready",
    triggerOptions: {},
    overrides: {},
    carries: [READY_LINK, HEAD_2_SHORT_SHA, SECOND_BRIEF_REV],
  },
  {
    terminal: "capped",
    triggerOptions: {},
    overrides: { spend: { maxGenerationsPerDay: 1 } },
    carries: [CAPPED_LINE, HEAD_2_SHORT_SHA],
  },
  {
    terminal: "on-demand",
    triggerOptions: { requiresTriggerApproval: true },
    overrides: {},
    carries: [ON_DEMAND_HEADING, SECOND_BRIEF_REV],
  },
];

const OUTAGES = [
  { outage: "delete", failDuring: failEntryDeletesDuring },
  { outage: "post", failDuring: failEntryPostsDuring },
] as const;

const OLDER_HEAD_TABLE = OLDER_HEAD_CASES.flatMap((olderHeadCase) =>
  OUTAGES.map((outage) => ({ ...olderHeadCase, ...outage })),
);

/** HEAD_1's ready Entry is live; GitHub now names HEAD_2, whose trigger answers. */
async function moveHeadPastReadyEntry(
  github: FakeGitHub,
  options: TriggerOptions = {},
): Promise<Awaited<ReturnType<typeof trigger>>> {
  const { payload: olderHead } = await trigger(HEAD_1);
  await makeTask({ github })(olderHead);
  const triggered = await trigger(HEAD_2, options);
  github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
  return triggered;
}

const MAINTAINER_NOTE = "A maintainer's note, no Entry marker";
const DRAFTS_OFF_SETTINGS = "version: 1\nentryCommentOnDrafts: false\n";

const KEPT_ON_MERGED_PR = [
  {
    kept: "an older head's ready body",
    body: buildEntryCommentBody(t, makeEntryLink(HEAD_1)),
  },
  {
    kept: "an older head's closed body",
    body: buildEntryCommentClosedBody(t, HEAD_1),
  },
  { kept: "an unmarked comment", body: MAINTAINER_NOTE },
];

const HUMAN_USER_ID = 7_000n;
const STALE_HEAD_INDEX = 5;
const ORPHAN_COMMENT_ID = 11n;
const HUMAN_COMMENT_ID = 12n;
const APP_NOTE_ID = 13n;

describe("generate task, Entry sync", () => {
  it("the next Entry write deletes an Entry comment a killed run left", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    const orphanBody = buildEntryCommentGeneratingBody(
      t,
      makeEntryLink(HEAD_1),
    );
    const onThread = { prNumber: 7, authorId: FAKE_APP_BOT_USER_ID };
    github.addComment(REPO, ORPHAN_COMMENT_ID, orphanBody, onThread);
    github.addComment(REPO, HUMAN_COMMENT_ID, `quoting: ${orphanBody}`, {
      prNumber: 7,
      authorId: HUMAN_USER_ID,
    });
    github.addComment(REPO, APP_NOTE_ID, "An App note", onThread);

    await makeTask({ github })(payload);

    const live = github.readComments(REPO);
    expect(live.has(ORPHAN_COMMENT_ID)).toBe(false);
    expect(live.has(HUMAN_COMMENT_ID)).toBe(true);
    expect(live.has(APP_NOTE_ID)).toBe(true);
    const entries = [...live.values()].filter((body) =>
      body.startsWith("**[Read the brief"),
    );
    expect(entries).toHaveLength(1);
  });

  it("a last attempt whose failed post fails queues the Entry sync", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await failFirstAttempt(github, payload);
    const outage = failEntryPostsDuring(github);
    const failing = stubGenerator();
    failing.failNextWith = makeConnectionError();

    await expect(
      makeTask({ github, generator: failing })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("Connection error");

    expect(readLiveBodies(github)).toEqual([]);
    const jobs = await readEntrySyncJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["key"]).toBe(`sync-entry:${pr.id}:${HEAD_1}`);
    expect(jobs[0]?.["max_attempts"]).toBe(ENTRY_SYNC_MAX_ATTEMPTS);
    const delay = Number(jobs[0]?.["delay"]);
    expect(delay).toBeGreaterThan(
      ENTRY_SYNC_DELAY_SECONDS - DELAY_BOUND_SECONDS,
    );
    outage.down = false;

    await makeSyncEntryTask({ github })(jobs[0]?.["payload"]);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(UNAVAILABLE_REASON);
  });

  it("queues the sync ahead of a terminal row write that throws", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    refuseDiffs(github);
    await harness.raw(`
      create function refuse_failed_write() returns trigger as $$
      begin
        if new.status = 'failed' then
          raise exception 'failed write refused';
        end if;
        return new;
      end $$ language plpgsql`);
    await harness.raw(
      "create trigger refuse_failed before update on generation for each row execute function refuse_failed_write()",
    );

    await expect(makeTask({ github })(payload)).rejects.toThrow(
      /update "generation"/,
    );

    expect(await readEntrySyncJobs()).toHaveLength(1);
  });

  it("a failure before the source opened still gets its failed Entry", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await failFirstAttempt(github, payload);
    await harness.raw(
      "update generation set status = 'running', run_id = gen_random_uuid(), lease_expires_at = now() - interval '1 second'",
    );
    const offline = makeGitHub(HEAD_1);
    offline.bindInstallationGitHub = () => {
      throw new Error("installation token mint failed");
    };

    await expect(
      makeRecoveryTask({ github: offline })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("token mint failed");
    const [generating] = readLiveBodies(github);
    expect(generating).toContain("Brief is generating for this push");
    const [job] = await readEntrySyncJobs();

    await makeSyncEntryTask({ github })(job?.["payload"]);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(EXHAUSTED_REASON);
  });

  it("a head whose claims are spent queues the Entry sync", async () => {
    const { payload } = await trigger(HEAD_1);
    await harness.raw(
      "update generation set status = 'running', run_id = gen_random_uuid(), claims = 3, lease_expires_at = now() - interval '1 second'",
    );

    await makeRecoveryTask()(payload, { job: FIRST_ATTEMPT });

    expect(await readEntrySyncJobs()).toHaveLength(1);
  });

  it("on a closed PR the sync replaces the on-demand body", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    await makeTask({ github })(payload);
    const [onDemand] = readLiveBodies(github);
    expect(onDemand).toContain("available on demand");
    github.updatePullRequest(PR_REF, { state: "closed" });

    await makeSyncEntryTask({ github })(payload);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(CLOSED_HEADING);
    expect(bodies[0]).toContain("`aaaaaaa`");
  });

  it("on a closed PR the sync replaces the head's capped body", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await harness.raw("update generation set status = 'capped'");
    await trackCappedEntry(github, pr.id);
    github.updatePullRequest(PR_REF, { state: "closed" });

    await makeSyncEntryTask({ github })(payload);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(CLOSED_HEADING);
  });

  it("the sync names the runs a refused large run needed", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await harness.raw(
      `update generation set status = 'capped', error_params = '{"needed":9,"left":4,"cap":20}'`,
    );
    await trackCappedEntry(github, pr.id);

    await makeSyncEntryTask({ github })(payload);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("needs 9 more runs to be briefed in parts");
    expect(bodies[0]).toContain("had 4 left today");
  });

  it("on a reopened PR the sync replaces the closed body", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await harness.raw(
      "update generation set status = 'failed', error_code = 'attempts-exhausted'",
    );
    await trackEntryBody(github, pr.id, buildEntryCommentClosedBody(t, HEAD_1));

    await makeSyncEntryTask({ github })(payload);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(EXHAUSTED_REASON);
  });

  it("the sync relinks a ready body that names an older revision", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await makeTask({ github })(payload);
    const [current] = readLiveBodies(github);
    const stale = buildEntryCommentBody(
      t,
      makeEntryLink(HEAD_1, STALE_HEAD_INDEX),
    );
    await trackEntryBody(github, pr.id, stale);

    await makeSyncEntryTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([current]);
  });

  it("on a merged PR the sync keeps the head's ready body", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await makeTask({ github })(payload);
    const ready = readLiveBodies(github);
    github.updatePullRequest(PR_REF, { state: "closed", merged: true });
    const before = listCommentCalls(github).length;

    await makeSyncEntryTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual(ready);
    const calls = listCommentCalls(github).slice(before);
    expect(calls.filter((call) => call === "post")).toEqual([]);
  });

  it("on a merged PR the sync creates no comment someone deleted", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await makeTask({ github })(payload);
    for (const commentId of github.readComments(REPO).keys()) {
      github.removeComment(REPO, commentId);
    }
    github.updatePullRequest(PR_REF, { state: "closed", merged: true });

    await makeSyncEntryTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([]);
  });

  it("a draft whose settings read fails is retried, not dropped", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await failFirstAttempt(github, payload);
    await harness.raw(
      "update generation set status = 'failed', error_code = 'attempts-exhausted'",
    );
    github.updatePullRequest(PR_REF, { draft: true });
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );

    await expect(makeSyncEntryTask({ github })(payload)).rejects.toThrow(
      "settings read failed",
    );
  });

  it("a write GitHub refuses for good ends the sync without a retry", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await failFirstAttempt(github, payload);
    await harness.raw(
      "update generation set status = 'failed', error_code = 'attempts-exhausted'",
    );
    github.failOn("postEntryComment", FakeFailures.FORBIDDEN);

    await expect(
      makeSyncEntryTask({ github })(payload),
    ).resolves.toBeUndefined();
  });

  it("a comment read GitHub refuses for good ends the sync", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await failFirstAttempt(github, payload);
    await harness.raw(
      "update generation set status = 'failed', error_code = 'attempts-exhausted'",
    );
    github.failOn("fetchComment", FakeFailures.FORBIDDEN);

    await expect(
      makeSyncEntryTask({ github })(payload),
    ).resolves.toBeUndefined();
  });

  it("leaves the thread to a newer head", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await failFirstAttempt(github, payload);
    await harness.raw(
      "update generation set status = 'failed', error_code = 'attempts-exhausted'",
    );
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const before = listCommentCalls(github).length;

    await makeSyncEntryTask({ github })(payload);

    expect(listCommentCalls(github).slice(before)).toEqual([]);
  });

  it("closes an older head's generating body on a PR merged mid-debounce", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload: olderHead } = await trigger(HEAD_1);
    await failFirstAttempt(github, olderHead);
    const [generating] = readLiveBodies(github);
    expect(generating).toContain("`aaaaaaa`");
    const { payload } = await trigger(HEAD_2);
    github.updatePullRequest(PR_REF, {
      headSha: HEAD_2,
      state: "closed",
      merged: true,
    });

    await makeSyncEntryTask({ github })(payload);

    const bodies = readLiveBodies(github);
    expect(bodies).toEqual([buildEntryCommentClosedBody(t, HEAD_2)]);
  });

  it("renders a merged PR's last head for a sync aimed at an older one", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload: olderHead } = await trigger(HEAD_1);
    await failFirstAttempt(github, olderHead);
    await trigger(HEAD_2);
    github.updatePullRequest(PR_REF, {
      headSha: HEAD_2,
      state: "closed",
      merged: true,
    });

    await makeSyncEntryTask({ github })(olderHead);

    expect(readLiveBodies(github)).toEqual([
      buildEntryCommentClosedBody(t, HEAD_2),
    ]);
  });

  it("keeps a merged PR's last ready body for a sync aimed at an older head", async () => {
    const github = makeGitHub(HEAD_2);
    const { payload: olderHead } = await trigger(HEAD_1);
    const { payload } = await trigger(HEAD_2);
    await makeTask({ github })(payload);
    const ready = readLiveBodies(github);
    expect(ready[0]).toContain("`bbbbbbb`");
    github.updatePullRequest(PR_REF, { state: "closed", merged: true });
    const before = listCommentCalls(github).length;

    await makeSyncEntryTask({ github })(olderHead);

    expect(readLiveBodies(github)).toEqual(ready);
    expect(listCommentCalls(github).slice(before)).not.toContain("post");
  });

  it("a pending row's sync leaves its generating body", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await failFirstAttempt(github, payload);
    await harness.raw("update generation set status = 'pending'");
    const live = readLiveBodies(github);

    await makeSyncEntryTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual(live);
  });

  it("a write GitHub refuses throws for a retry, the last one alerts", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await failFirstAttempt(github, payload);
    await harness.raw(
      "update generation set status = 'failed', error_code = 'attempts-exhausted'",
    );
    failEntryPostsDuring(github);
    const { logger, readLines } = captureLogger();
    const lastSync = {
      ...LAST_ATTEMPT,
      attempts: ENTRY_SYNC_MAX_ATTEMPTS,
      max_attempts: ENTRY_SYNC_MAX_ATTEMPTS,
    };

    await expect(
      makeSyncEntryTask({ github, log: logger })(payload, {
        job: FIRST_ATTEMPT,
      }),
    ).rejects.toThrow("write failed");
    await expect(
      makeSyncEntryTask({ github, log: logger })(payload, { job: lastSync }),
    ).rejects.toThrow("write failed");

    const levels = readLines()
      .filter((line) => String(line["msg"]).startsWith("entry sync:"))
      .map((line) => [line["level"], line["evt"]]);
    expect(levels).toEqual([
      ["warn", undefined],
      ["error", "job.retries.exhausted"],
    ]);
  });

  it("a retargeted head's failed rerun keeps its failed Entry", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1);
    await makeTask({ github })(payload);
    github.updatePullRequest(PR_REF, { baseSha: RETARGETED_BASE });
    const failing = stubGenerator();
    failing.failNextWith = makeConnectionError();
    await expect(
      makeTask({ github, generator: failing })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("Connection error");
    const [failed] = readLiveBodies(github);
    expect(failed).toContain(UNAVAILABLE_REASON);

    await makeSyncEntryTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([failed]);
  });

  it("a ready post GitHub fails transiently queues the Entry sync", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await failFirstAttempt(github, payload);
    const outage = failEntryPostsDuring(github);

    await makeTask({ github })(payload, { job: SECOND_ATTEMPT });

    expect(readLiveBodies(github)).toEqual([]);
    const [job] = await readEntrySyncJobs();
    expect(job).toBeDefined();
    outage.down = false;

    await makeSyncEntryTask({ github })(job?.["payload"]);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(READY_LINK);
  });

  it("an on-demand post GitHub fails transiently queues the Entry sync", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    const outage = failEntryPostsDuring(github);

    await makeTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([]);
    const [job] = await readEntrySyncJobs();
    expect(job).toBeDefined();
    outage.down = false;

    await makeSyncEntryTask({ github })(job?.["payload"]);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(ON_DEMAND_TOKEN);
  });

  it("a capped post GitHub fails transiently queues the Entry sync", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload: briefedHead } = await trigger(HEAD_1);
    await makeTask({ github })(briefedHead);
    const { payload } = await trigger(HEAD_2);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const outage = failEntryPostsDuring(github);

    await makeTask({ github, spend: { maxGenerationsPerDay: 1 } })(payload);

    expect(readLiveBodies(github)).toEqual([]);
    const [job] = await readEntrySyncJobs();
    expect(job).toBeDefined();
    outage.down = false;

    await makeSyncEntryTask({ github })(job?.["payload"]);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("`bbbbbbb`");
    expect(bodies[0]).toContain("daily generation cap");
  });

  it("a ready post GitHub refuses for good queues no Entry sync", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await failFirstAttempt(github, payload);
    github.failOn("postEntryComment", FakeFailures.FORBIDDEN);

    await makeTask({ github })(payload, { job: SECOND_ATTEMPT });

    expect(await readEntrySyncJobs()).toEqual([]);
  });

  it("a draft's ready post its unread settings held queues the sync", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );

    await makeTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([]);
    expect(await readEntrySyncJobs()).toHaveLength(1);
  });
});

describe("generate task, Entry sync after a lost swap", () => {
  it("a stale sync that wins the swap is reconciled to the stored brief", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await failKeepingGeneratingBody(github, payload);
    expect(readLiveBodies(github)).toEqual([
      buildEntryCommentGeneratingBody(t, makeEntryLink(HEAD_1)),
    ]);
    const race = interleaveSameHeadRace(github, true);
    const sync = runEntrySyncJob(await readQueuedEntrySync(), { github });
    await race.syncRead.reached;
    const ingest = createIngestRoutines(harness.handle, ctx);
    await ingest.triggerOnDemand({ pullRequestId: pr.id });
    const rerun = makeTask({ github })(payload);
    await race.readyDelete.reached;
    race.syncRead.release();
    await sync;
    race.readyDelete.release();
    await rerun;
    const generator = stubGenerator();

    const ran = await drainEntrySyncJobs({ github, generator });

    expect(ran).toBe(1);
    expect(generator.calls).toEqual([]);
    expect(readLiveBodies(github)).toEqual([
      buildEntryCommentBody(t, makeEntryLink(HEAD_1)),
    ]);
    expect(await readTrackedCommentId(pr)).toBe(listLiveCommentIds(github)[0]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(await readEntrySyncJobs()).toEqual([]);
  });

  it("a ready post that wins the swap survives the sync that lost it", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await failKeepingGeneratingBody(github, payload);
    const race = interleaveSameHeadRace(github, false);
    const sync = runEntrySyncJob(await readQueuedEntrySync(), { github });
    await race.syncRead.reached;
    const ingest = createIngestRoutines(harness.handle, ctx);
    await ingest.triggerOnDemand({ pullRequestId: pr.id });
    await makeTask({ github })(payload);
    const ready = buildEntryCommentBody(t, makeEntryLink(HEAD_1));
    expect(readLiveBodies(github)).toEqual([ready]);
    race.syncRead.release();
    await sync;
    const settled = listCommentCalls(github).length;

    const ran = await drainEntrySyncJobs({ github });

    expect(ran).toBe(1);
    expect(listCommentCalls(github).slice(settled)).not.toContain("post");
    expect(readLiveBodies(github)).toEqual([ready]);
    expect(await readTrackedCommentId(pr)).toBe(listLiveCommentIds(github)[0]);
    expect(await readEntrySyncJobs()).toEqual([]);
  });

  it("a sync over an already current Entry posts nothing and stops", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await makeTask({ github })(payload);
    const ready = readLiveBodies(github);
    const ingest = createIngestRoutines(harness.handle, ctx);
    await ingest.queueEntrySync({
      pullRequestId: pr.id,
      headSha: HEAD_1,
      delaySeconds: 0,
    });
    const before = listCommentCalls(github).length;

    const ran = await drainEntrySyncJobs({ github });

    expect(ran).toBe(1);
    expect(listCommentCalls(github).slice(before)).not.toContain("post");
    expect(readLiveBodies(github)).toEqual(ready);
    expect(await readEntrySyncJobs()).toEqual([]);
  });

  it("a PR merged mid-generation converges to the stored brief's Entry", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    const generator = mergeDuringGeneration(github, payload);
    await makeTask({ github, generator })(payload);
    expect(readLiveBodies(github)).toEqual([
      buildEntryCommentClosedBody(t, HEAD_1),
    ]);
    const syncGenerator = stubGenerator();

    const ran = await drainEntrySyncJobs({ github, generator: syncGenerator });

    expect(ran).toBe(1);
    expect(syncGenerator.calls).toEqual([]);
    expect(readLiveBodies(github)).toEqual([
      buildEntryCommentBody(t, makeEntryLink(HEAD_1)),
    ]);
    expect(await readTrackedCommentId(pr)).toBe(listLiveCommentIds(github)[0]);
    expect(await readEntrySyncJobs()).toEqual([]);
    const settled = listCommentCalls(github).length;
    await makeSyncEntryTask({ github })(payload);
    expect(listCommentCalls(github).slice(settled)).not.toContain("post");
    expect(await readEntrySyncJobs()).toEqual([]);
  });

  it.each(LOST_SWAP_CASES)(
    "a $writer post that loses its swap converges through the sync",
    async ({ arrange, isTarget, expected }) => {
      const github = makeGitHub(HEAD_1);
      const { pr, payload, headSha, overrides } = await arrange(github);
      storeStaleWinnerOnPost(github, pr, headSha, isTarget);

      await makeTask({ github, ...overrides })(payload);

      expect(await readEntrySyncJobs()).toHaveLength(1);
      const ran = await drainEntrySyncJobs({ github });
      const bodies = readLiveBodies(github);
      expect(ran).toBe(1);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toContain(expected);
      expect(await readTrackedCommentId(pr)).toBe(
        listLiveCommentIds(github)[0],
      );
    },
  );
});

describe("generate task, Entry sync over an older head's Entry", () => {
  it.each(OLDER_HEAD_TABLE)(
    "a $terminal post recovers an older Entry after a $outage outage",
    async ({ triggerOptions, overrides, carries, failDuring }) => {
      const github = makeGitHub(HEAD_1);
      const { pr, payload } = await moveHeadPastReadyEntry(
        github,
        triggerOptions,
      );
      const outage = failDuring(github);

      await makeTask({ github, ...overrides })(payload);

      const landed = readLiveBodies(github).some((body) =>
        isCarryingAll(body, carries),
      );
      expect(landed).toBe(false);
      expect(await readEntrySyncJobs()).toHaveLength(1);
      outage.down = false;
      const ran = await drainEntrySyncJobs({ github });
      const bodies = readLiveBodies(github);
      expect(ran).toBe(1);
      expect(bodies).toHaveLength(1);
      for (const copy of carries) {
        expect(bodies[0]).toContain(copy);
      }
      expect(await readTrackedCommentId(pr)).toBe(
        listLiveCommentIds(github)[0],
      );
    },
  );

  it.each(KEPT_ON_MERGED_PR)(
    "a merged PR's ready sync keeps $kept",
    async ({ body }) => {
      const github = makeGitHub(HEAD_2);
      const { pr, payload } = await trigger(HEAD_2);
      await makeTask({ github })(payload);
      github.updatePullRequest(PR_REF, { state: "closed", merged: true });
      await trackEntryBody(github, pr.id, body);
      const before = listCommentCalls(github).length;

      await makeSyncEntryTask({ github })(payload);

      expect(readLiveBodies(github)).toEqual([body]);
      expect(listCommentCalls(github).slice(before)).not.toContain("post");
    },
  );

  it("a failed head's sync keeps the older head's ready Entry", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await moveHeadPastReadyEntry(github);
    const older = readLiveBodies(github);
    const outage = failEntryDeletesDuring(github);
    const failing = stubGenerator();
    failing.failNextWith = makeConnectionError();
    await expect(
      makeTask({ github, generator: failing })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("Connection error");
    outage.down = false;

    const ran = await drainEntrySyncJobs({ github });

    expect(ran).toBe(1);
    expect(readLiveBodies(github)).toEqual(older);
  });

  it("a ready sync leaves an unmarked comment the row tracks", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await moveHeadPastReadyEntry(github);
    const outage = failEntryDeletesDuring(github);
    await makeTask({ github })(payload);
    await trackEntryBody(github, pr.id, MAINTAINER_NOTE);
    outage.down = false;

    const ran = await drainEntrySyncJobs({ github });

    expect(ran).toBe(1);
    expect(readLiveBodies(github)).toEqual([MAINTAINER_NOTE]);
  });

  it("a drafts-off sync deletes the older Entry and posts nothing", async () => {
    const github = makeGitHub(HEAD_1);
    const { payload } = await moveHeadPastReadyEntry(github);
    github.updatePullRequest(PR_REF, { draft: true });
    github.addRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      {
        kind: "file",
        content: DRAFTS_OFF_SETTINGS,
        blobSha: "sha-s",
        size: DRAFTS_OFF_SETTINGS.length,
      },
    );
    const outage = failEntryDeletesDuring(github);
    await makeTask({ github })(payload);
    expect(readLiveBodies(github)).toHaveLength(1);
    outage.down = false;

    const ran = await drainEntrySyncJobs({ github });

    expect(ran).toBe(1);
    expect(readLiveBodies(github)).toEqual([]);
  });
});

describe("generate task, Entry sync when a lost swap meets an outage", () => {
  it("an adopted comment whose head read fails is left to the sync", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    const winner = buildEntryCommentGeneratingBody(t, makeEntryLink(HEAD_1));
    storeStaleWinnerOnPost(github, pr, HEAD_1, (body) =>
      body.startsWith(`**[${GENERATING_LINK}`),
    );
    const generator = failConfirmReadAfterGenerating(github);

    await makeTask({ github, generator })(payload);

    expect(readLiveBodies(github)).toEqual([winner]);
    expect(await readEntrySyncJobs()).toHaveLength(1);
    const ran = await drainEntrySyncJobs({ github });
    expect(ran).toBe(1);
    expect(readLiveBodies(github)).toEqual([
      buildEntryCommentBody(t, makeEntryLink(HEAD_1)),
    ]);
  });

  it("a sync that cannot queue its successor throws for a retry", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await harness.raw(
      "update generation set status = 'failed', error_code = 'attempts-exhausted'",
    );
    storeWinnerWithQueueOffline(github, pr);

    const sync = makeSyncEntryTask({ github })(payload);

    await expect(sync).rejects.toThrow("successor");
    await harness.raw(
      "alter table graphile_worker.jobs_offline rename to jobs",
    );
    await makeSyncEntryTask({ github })(payload);
    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(EXHAUSTED_REASON);
  });
});

/** The body as it was posted before Entry bodies carried their kind token. */
function stripEntryBodyToken(
  body: string,
  kind: EntryBodyKind,
  headSha: string,
): string {
  const tokenless = body.replace(
    `\n${formatEntryBodyToken(kind, headSha)}`,
    "",
  );
  expect(tokenless).not.toBe(body);
  return tokenless;
}

describe("generate task, Entry sync over a body with no kind token", () => {
  it("on a merged PR the sync reposts a tokenless ready body once", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await makeTask({ github })(payload);
    const [ready = ""] = readLiveBodies(github);
    const tokenless = stripEntryBodyToken(ready, EntryBodyKinds.READY, HEAD_1);
    await trackEntryBody(github, pr.id, tokenless);
    github.updatePullRequest(PR_REF, { state: "closed", merged: true });
    const before = listCommentCalls(github).length;

    await makeSyncEntryTask({ github })(payload);
    await makeSyncEntryTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([ready]);
    const calls = listCommentCalls(github).slice(before);
    expect(calls.filter((call) => call === "post")).toEqual(["post"]);
  });

  it("on an open PR a failed row's sync leaves a tokenless body", async () => {
    const github = makeGitHub(HEAD_1);
    const { pr, payload } = await trigger(HEAD_1);
    await harness.raw(
      "update generation set status = 'failed', error_code = 'attempts-exhausted'",
    );
    const generating = buildEntryCommentGeneratingBody(
      t,
      makeEntryLink(HEAD_1),
    );
    const kind = EntryBodyKinds.GENERATING;
    const tokenless = stripEntryBodyToken(generating, kind, HEAD_1);
    await trackEntryBody(github, pr.id, tokenless);

    await makeSyncEntryTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([tokenless]);
  });
});
