// A push during a multi-call run: before the first detail call it ends the
// run superseded as any push does; from the first detail call on, the run is
// pinned and finishes on its head, its Entry posts standing down.
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
  parseScopeContext,
} from "persistence";
import { GeneratorError, GeneratorErrorKinds } from "generators";
import { createI18n } from "i18n";
import { claimTestRun } from "persistence/testing";
import { GenerationStatuses } from "types/generations";
import { PrStates } from "types/pull-requests";
import { describe, expect, it } from "vitest";
import {
  BASE,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  listCommentCalls,
  makeGitHub,
  makeMultiCallGitHub,
  makeRecoveryTask,
  makeRepoId,
  makeTarget,
  makeTask,
  PR_REF,
  readLiveBodies,
  seedViewerGrant,
  setUpHarness,
  stubGenerator,
  stubThreeGroupGenerator,
  trigger,
  type ThreeGroupStubGenerator,
} from "./helpers";

setUpHarness();

const { t } = createI18n();

const POLL_MS = 5;

/** A 5 ms poll rounds up to one second, plus the five-second after-lease margin. */
const ONE_POLL_DELAY_SECONDS = 6;

const OTHER_RUN_ID = "00000000-0000-4000-8000-000000000000";

/** HEAD_1's run holds a live two-minute lease, as a run mid-generation does. */
async function holdHeadOneRun(): Promise<void> {
  await harness.raw(
    "update generation set status = 'running', run_id = $1, lease_expires_at = now() + interval '2 minutes' where head_sha = $2",
    [OTHER_RUN_ID, HEAD_1],
  );
}

/** The delays of the unlocked jobs `task` queued, in seconds from now. */
async function readQueuedDelays(task: string): Promise<number[]> {
  const rows = await harness.raw(
    "select extract(epoch from (run_at - now()))::float8 as delay from graphile_worker.jobs where task_identifier = $1 and locked_at is null",
    [task],
  );
  return rows.map((row) => Number(row["delay"]));
}

/** The Entry writes GitHub took, `post` or `edit`, without the reads and deletes. */
function listEntryWrites(
  github: ReturnType<typeof makeMultiCallGitHub>,
): string[] {
  const writes = listCommentCalls(github).filter(
    (call) => call === "post" || call.startsWith("edit:"),
  );
  return writes.map((call) => call.replace(/:.*$/, ""));
}

/** The push lands while `label` is in flight; the next poll sees it. */
function pushHeadDuring(
  generator: ThreeGroupStubGenerator,
  github: ReturnType<typeof makeMultiCallGitHub>,
  label: string,
): void {
  generator.onCall = async (called) => {
    if (called === label) {
      github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
      await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
    }
  };
}

describe("a push during a multi-call run", () => {
  it("ends the run superseded while the grouping call is in flight", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    pushHeadDuring(generator, github, "grouping");

    await makeTask({
      generator,
      github,
      forceMultiCall: true,
      headPollIntervalMs: POLL_MS,
    })(payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const row = await projection.get(makeTarget(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatuses.SUPERSEDED);
    expect(generator.calls).not.toContain("detail:2");
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        BASE,
        HEAD_1,
      ),
    ).toBeUndefined();
  });

  it("finishes on its head once a detail call started and posts no Entry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    pushHeadDuring(generator, github, "detail:1");

    await makeTask({
      generator,
      github,
      forceMultiCall: true,
      headPollIntervalMs: POLL_MS,
    })(payload);

    expect(generator.calls.slice(0, 3)).toEqual([
      "grouping",
      "detail:1",
      "detail:2",
    ]);
    const projection = createGenerationProjection(harness.handle, ctx);
    const row = await projection.get(makeTarget(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        BASE,
        HEAD_1,
      ),
    ).toBeDefined();
    // The generating post and its edit went up before the push; the ready post stood down.
    expect(listEntryWrites(github)).toEqual(["post", "edit"]);
    expect(readLiveBodies(github)[0]).toContain("generated in 2 parts");
  });

  it("keeps the newer head's run behind a pinned run's live claim", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    const newerGenerator = stubGenerator();
    let newerPayload: unknown;
    generator.onCall = async (called) => {
      if (called !== "detail:1") {
        return;
      }
      github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
      newerPayload = (await trigger(HEAD_2)).payload;
      await makeTask({ generator: newerGenerator, github })(newerPayload);
    };

    await makeTask({
      generator,
      github,
      forceMultiCall: true,
      headPollIntervalMs: POLL_MS,
    })(payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const briefs = createArtifactStore(harness.handle, ctx).briefs;
    expect((await projection.get(makeTarget(pr, HEAD_1)))?.status).toBe(
      GenerationStatuses.SUCCEEDED,
    );
    expect((await briefs.get(pr.id, BASE, HEAD_1))?.headIndex).toBe(1);
    expect(newerGenerator.calls).toHaveLength(0);
    const queued = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'generate' and payload->>'head_sha' = $1",
      [HEAD_2],
    );
    expect(queued.length).toBeGreaterThan(0);

    await makeTask({ generator: newerGenerator, github })(newerPayload);

    expect((await briefs.get(pr.id, BASE, HEAD_2))?.headIndex).toBe(2);
  });

  it("posts the ready Entry when the head moves back before the run ends", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    generator.onCall = async (called) => {
      if (called === "detail:1") {
        github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
        await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
      }
      if (called === "detail:2") {
        github.updatePullRequest(PR_REF, { headSha: HEAD_1 });
      }
    };

    await makeTask({
      generator,
      github,
      forceMultiCall: true,
      headPollIntervalMs: POLL_MS,
    })(payload);

    const bodies = readLiveBodies(github);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(t("entryComment.ready.link"));
  });

  it("leaves the failed Entry to the newer head when a pinned run fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    pushHeadDuring(generator, github, "detail:1");
    generator.failOn(
      "detail:2",
      new GeneratorError(GeneratorErrorKinds.REFUSAL, "refused"),
    );

    await makeTask({
      generator,
      github,
      forceMultiCall: true,
      headPollIntervalMs: POLL_MS,
    })(payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const row = await projection.get(makeTarget(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(listEntryWrites(github)).toEqual(["post", "edit"]);
    expect(readLiveBodies(github)[0]).toContain("generated in 2 parts");
  });

  it.each([
    ["succeeds", undefined, GenerationStatuses.SUCCEEDED],
    [
      "fails",
      new GeneratorError(GeneratorErrorKinds.REFUSAL, "refused"),
      GenerationStatuses.FAILED,
    ],
  ])(
    "schedules the moved head for a url-box PR when a pinned run %s",
    async (_ending, detailFailure, status) => {
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
      const projection = createGenerationProjection(harness.handle, ownerCtx);
      await projection.upsertPending(makeTarget(pr, HEAD_1));
      const github = makeMultiCallGitHub(HEAD_1);
      const generator = stubThreeGroupGenerator();
      pushHeadDuring(generator, github, "detail:1");
      if (detailFailure !== undefined) {
        generator.failOn("detail:2", detailFailure);
      }

      await makeTask({
        generator,
        github,
        forceMultiCall: true,
        headPollIntervalMs: POLL_MS,
      })({
        owner_user_id: "555",
        grant_id: String(grantId),
        pull_request_id: String(pr.id),
        head_sha: HEAD_1,
      });

      expect((await projection.get(makeTarget(pr, HEAD_1)))?.status).toBe(
        status,
      );
      expect((await projection.get(makeTarget(pr, HEAD_2)))?.status).toBe(
        GenerationStatuses.PENDING,
      );
      const jobs = await harness.raw(
        "select payload from graphile_worker.jobs where task_identifier = 'generate'",
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.["payload"]).toMatchObject({
        grant_id: String(grantId),
        head_sha: HEAD_2,
      });
    },
  );
});

describe("a newer head behind another head's run", () => {
  it("rechecks after one head poll, not the holder's whole lease", async () => {
    await trigger(HEAD_1);
    await holdHeadOneRun();
    const { payload } = await trigger(HEAD_2);
    await harness.raw("update graphile_worker.jobs set locked_at = now()");
    const generator = stubGenerator();

    await makeTask({
      generator,
      github: makeGitHub(HEAD_2),
      headPollIntervalMs: POLL_MS,
    })(payload);

    expect(generator.calls).toHaveLength(0);
    const delays = await readQueuedDelays("generate");
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeLessThanOrEqual(ONE_POLL_DELAY_SECONDS);
  });

  it("moves a recovery job to one head poll behind the holder", async () => {
    await trigger(HEAD_1);
    await holdHeadOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const projection = createGenerationProjection(harness.handle, ctx);
    await claimTestRun(projection, makeTarget(pr, HEAD_2));
    await harness.raw(
      "update generation set lease_expires_at = now() - interval '1 second' where head_sha = $1",
      [HEAD_2],
    );
    await harness.raw("update graphile_worker.jobs set locked_at = now()");
    const generator = stubGenerator();

    await makeRecoveryTask({
      generator,
      github: makeGitHub(HEAD_2),
      headPollIntervalMs: POLL_MS,
    })(payload);

    expect(generator.calls).toHaveLength(0);
    const delays = await readQueuedDelays("recover-generation");
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeLessThanOrEqual(ONE_POLL_DELAY_SECONDS);
  });
});
