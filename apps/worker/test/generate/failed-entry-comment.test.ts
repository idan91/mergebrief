import { createI18n } from "i18n";
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import {
  GeneratorError,
  GeneratorErrorKinds,
  type Effort,
  type GenerateRequest,
  type Generator,
} from "generators";
import {
  createGenerationProjection,
  createTenantRepository,
  parseScopeContext,
} from "persistence";
import { FakeFailures, type FakeGitHub } from "github/testing";
import { RepoConfigPaths } from "repo-config";
import {
  GenerationFailureCodes,
  GenerationStatuses,
  PrStates,
  type GenerationFailureCode,
} from "types";
import {
  buildEntryCommentClosedBody,
  buildEntryCommentFailedBody,
} from "../../src/task/entry-comment";
import {
  BASE,
  captureLogger,
  ctx,
  failHeadReadsAfterFirst,
  FIRST_ATTEMPT,
  FIRST_BRIEF_INDEX,
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
  runAfterEachPost,
  SECOND_ATTEMPT,
  seedViewerGrant,
  setUpHarness,
  storeAnotherRunsEntry,
  stubGenerator,
  trackCappedEntry,
  trackEntryBody,
  trigger,
} from "./helpers";

setUpHarness();

const { t } = createI18n();

function buildFailedBody(
  headSha: string,
  code: GenerationFailureCode,
  headIndex = FIRST_BRIEF_INDEX,
): string {
  return buildEntryCommentFailedBody(
    t,
    makeEntryLink(headSha, headIndex),
    code,
  );
}

const HOLDER_RUN_ID = "00000000-0000-4000-8000-000000000000";

/** The stub generator, except every call labelled `label` throws `error`. */
function stubGeneratorFailingOn(label: string, error: unknown): Generator {
  const inner = stubGenerator();
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      if (req.label === label) {
        throw error;
      }
      return inner.generate(req);
    },
    origin: (effort: Effort) => inner.origin(effort),
  };
}

const NEWEST_HEAD = "d".repeat(40);

type TriggeredPullRequest = Awaited<ReturnType<typeof trigger>>["pr"];

/** A brief call that lets another run take the Entry comment over, then fails for good. */
function stubGeneratorFailingAfter(interleave: () => Promise<void>): Generator {
  const inner = stubGenerator();
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      if (req.label === "brief") {
        await interleave();
        throw new GeneratorError(GeneratorErrorKinds.REFUSAL, "declined");
      }
      return inner.generate(req);
    },
    origin: (effort: Effort) => inner.origin(effort),
  };
}

/** The stub generator, except GitHub fails every head read once the brief call starts. */
function stubGeneratorUnreadingHeadAfterBrief(github: FakeGitHub): Generator {
  const inner = stubGenerator();
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      if (req.label === "brief") {
        github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
      }
      return inner.generate(req);
    },
    origin: (effort: Effort) => inner.origin(effort),
  };
}

/** What a newer head's generating refresh does: delete the tracked comment, post and store its own. */
async function takeOverEntryComment(
  github: FakeGitHub,
  pr: TriggeredPullRequest,
): Promise<void> {
  for (const commentId of github.readComments(REPO).keys()) {
    github.removeComment(REPO, commentId);
  }
  github.addComment(REPO, NEWER_COMMENT_ID, NEWER_BODY);
  const { pullRequests } = createTenantRepository(harness.handle, ctx);
  const tracked = await pullRequests.getById(pr.id);
  await pullRequests.swapEntryComment(pr.id, {
    seen: tracked?.entryCommentId ?? null,
    next: NEWER_COMMENT_ID,
  });
}

const SAME_HEAD_COMMENT_ID = 9_002n;
const SAME_HEAD_BODY = "Another run's Entry comment for this head";

/** Another run stores its Entry inside this run's first post, then `after` runs. */
function storeOnceAfterFirstPost(
  github: FakeGitHub,
  pr: TriggeredPullRequest,
  after: () => void = () => undefined,
): void {
  let interleaved = false;
  runAfterEachPost(github, async () => {
    if (interleaved) {
      return;
    }
    interleaved = true;
    await storeAnotherRunsEntry(github, pr.id, {
      id: SAME_HEAD_COMMENT_ID,
      body: SAME_HEAD_BODY,
    });
    after();
  });
}

/** GitHub refuses the next Entry post only; the delete before it went through. */
function failFirstEntryPost(github: FakeGitHub): void {
  const refusing = makeGitHub(HEAD_1);
  refusing.failOn("postEntryComment", FakeFailures.SERVER_ERROR);
  const refusingRepo = refusing
    .bindInstallationGitHub(ctx.installationId)
    .forRepo(REPO);
  let posts = 0;
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async postEntryComment(input) {
      posts += 1;
      if (posts === 1) {
        return refusingRepo.postEntryComment(input);
      }
      return client.postEntryComment(input);
    },
  }));
}

/** Every write of the PR row's Entry id throws, as a lost connection would. */
async function refuseEntryCommentSwaps(): Promise<void> {
  await harness.raw(
    "create or replace function refuse_entry_swap() returns trigger language plpgsql as $$ begin raise exception 'entry swap refused'; end $$",
  );
  await harness.raw(
    "create trigger refuse_entry_swap before update on pull_request for each row when (old.entry_comment_id is distinct from new.entry_comment_id) execute function refuse_entry_swap()",
  );
}

async function readStoredCommentId(
  pr: TriggeredPullRequest,
): Promise<bigint | null> {
  const repo = createTenantRepository(harness.handle, ctx);
  const row = await repo.pullRequests.getById(pr.id);
  if (row === undefined) {
    throw new Error(`pull_request ${String(pr.id)} not found`);
  }
  return row.entryCommentId;
}

describe("generate task, failed Entry comment", () => {
  it("creates the failed comment on a permanent failure before the gate", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    refuseDiffs(github);

    await makeTask({ github })(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.DIFF_TOO_LARGE),
    ]);
  });

  it("a run whose id swap loses deletes its own comment, not the winner's", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    refuseDiffs(github);
    runAfterEachPost(github, () =>
      storeAnotherRunsEntry(github, pr.id, {
        id: NEWER_COMMENT_ID,
        body: NEWER_BODY,
      }),
    );

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([NEWER_BODY]);
    expect(await readStoredCommentId(pr)).toBe(NEWER_COMMENT_ID);
  });

  it("a swap that throws deletes the comment it just posted", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    let posts = 0;
    runAfterEachPost(github, async () => {
      posts += 1;
      if (posts === 1) {
        await refuseEntryCommentSwaps();
        return;
      }
      await harness.raw(
        "drop trigger if exists refuse_entry_swap on pull_request",
      );
    });

    await expect(
      makeTask({ github })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow('update "pull_request"');
    expect(readLiveBodies(github)).toEqual([]);
    await makeTask({ github })(payload, { job: SECOND_ATTEMPT });

    const [readyBody, ...others] = readLiveBodies(github);
    expect(others).toEqual([]);
    expect(readyBody).toContain("Read the brief for this push");
  });

  it("a swap that stored its id before throwing keeps tracking the comment", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    let posts = 0;
    runAfterEachPost(github, async () => {
      posts += 1;
      if (posts > 1) {
        await harness.raw(
          "drop trigger if exists refuse_entry_swap on pull_request",
        );
        return;
      }
      const [postedId] = github.readComments(REPO).keys();
      await harness.raw(
        "update pull_request set entry_comment_id = $1::bigint where id = $2::bigint",
        [String(postedId), String(pr.id)],
      );
      await harness.raw(
        "create or replace function refuse_entry_swap() returns trigger language plpgsql as $$ begin raise exception 'entry swap refused'; end $$",
      );
      await harness.raw(
        "create trigger refuse_entry_swap before update of entry_comment_id on pull_request for each statement execute function refuse_entry_swap()",
      );
    });

    await expect(
      makeTask({ github })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow('update "pull_request"');

    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.UNKNOWN),
    ]);
  });

  it("a run that lost its generating swap still lands its ready Entry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    storeOnceAfterFirstPost(github, pr);

    await makeTask({ github })(payload);

    const [readyId, ...others] = github.readComments(REPO).keys();
    expect(others).toEqual([]);
    expect(readLiveBodies(github)[0]).toContain("Read the brief for this push");
    expect(await readStoredCommentId(pr)).toBe(readyId);
  });

  it("leaves a comment it took after a lost swap when its head read fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    storeOnceAfterFirstPost(github, pr, () => {
      github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
    });

    await makeTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([SAME_HEAD_BODY]);
    expect(await readStoredCommentId(pr)).toBe(SAME_HEAD_COMMENT_ID);
  });

  it("posts nothing on a retrying failure and replaces on the last", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const first = stubGenerator();
    first.failNextWith = makeConnectionError();

    await expect(
      makeTask({ github, generator: first })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("Connection error");

    const [generating] = readLiveBodies(github);
    expect(generating).toContain("Brief is generating for this push");
    expect(readLiveBodies(github)).toHaveLength(1);

    const last = stubGenerator();
    last.failNextWith = makeConnectionError();
    await expect(
      makeTask({ github, generator: last })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("Connection error");

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.PROVIDER_UNAVAILABLE),
    ]);
  });

  it("leaves an older head's ready body alone", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await makeTask({ github })(first.payload);
    const [ready] = readLiveBodies(github);
    expect(ready).toContain("Read the brief for this push");

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    refuseDiffs(github);
    const second = await trigger(HEAD_2);
    await makeTask({ github })(second.payload);

    expect(await readRowStatus(second.pr, HEAD_2)).toBe(
      GenerationStatuses.FAILED,
    );
    expect(readLiveBodies(github)).toEqual([ready]);
  });

  it("links a newer head's failure to the revision its brief would take", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await makeTask({ github })(first.payload);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    const generator = stubGeneratorFailingOn(
      "brief",
      new GeneratorError(GeneratorErrorKinds.CONFIG, "bad model"),
    );
    await makeTask({ github, generator })(second.payload);

    const failed = buildFailedBody(
      HEAD_2,
      GenerationFailureCodes.GENERATION_CONFIG,
      FIRST_BRIEF_INDEX + 1,
    );
    expect(readLiveBodies(github)).toEqual([failed]);
    expect(failed).toContain("/pulls/7?rev=2)");
  });

  it("a later head's failure leaves an older head's failed body", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    refuseDiffs(github);
    await makeTask({ github })(first.payload);
    const olderFailed = buildFailedBody(
      HEAD_1,
      GenerationFailureCodes.DIFF_TOO_LARGE,
    );
    expect(readLiveBodies(github)).toEqual([olderFailed]);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await makeTask({ github })(second.payload);

    expect(readLiveBodies(github)).toEqual([olderFailed]);
  });

  it("keeps the ready body when a follow-on step fails after the brief", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: BASE,
      submittedAt: new Date(),
    });
    const github = makeGitHub(HEAD_1);
    const generator = stubGeneratorFailingOn(
      "delta",
      new GeneratorError(GeneratorErrorKinds.REFUSAL, "declined"),
    );

    await makeTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    const [body] = readLiveBodies(github);
    expect(readLiveBodies(github)).toHaveLength(1);
    expect(body).toContain("Read the brief for this push");
  });

  it("a stored brief whose ready post failed gets no failed comment", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: BASE,
      submittedAt: new Date(),
    });
    const github = makeGitHub(HEAD_1);
    runAfterEachPost(github, async () => {
      github.failOn("postEntryComment", FakeFailures.SERVER_ERROR);
    });
    const generator = stubGeneratorFailingOn(
      "delta",
      new GeneratorError(GeneratorErrorKinds.REFUSAL, "declined"),
    );

    await makeTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(listCommentCalls(github).filter((call) => call === "post")).toEqual([
      "post",
      "post",
    ]);
    expect(readLiveBodies(github)).toEqual([]);
  });

  it("a url-box job that fails makes no GitHub comment call", async () => {
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
    const github = makeGitHub(HEAD_1);
    refuseDiffs(github);

    await makeTask({ github })({
      owner_user_id: "555",
      grant_id: String(grantId),
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    const row = await createGenerationProjection(harness.handle, ownerCtx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(listCommentCalls(github)).toEqual([]);
  });

  it("a draft whose settings read failed posts and deletes nothing", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    refuseDiffs(github);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(listCommentCalls(github)).toEqual([]);
  });

  it("a failed comment post leaves the job's outcome unchanged", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    refuseDiffs(github);
    github.failOn("postEntryComment", FakeFailures.SERVER_ERROR);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([]);
  });

  it("a head whose attempts are spent posts the exhausted body", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await harness.raw(
      "update generation set status = 'running', run_id = $1, claims = 3, lease_expires_at = now() - interval '1 second'",
      ["00000000-0000-4000-8000-000000000000"],
    );
    const github = makeGitHub(HEAD_1);
    const generator = stubGenerator();

    await makeRecoveryTask({ github, generator })(payload, {
      job: FIRST_ATTEMPT,
    });

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.ATTEMPTS_EXHAUSTED),
    ]);
  });

  it("a spent head over a failed row posts the row's own code", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const first = stubGenerator();
    first.failNextWith = makeConnectionError();
    await expect(
      makeTask({ github, generator: first })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("Connection error");
    const [generating] = readLiveBodies(github);
    expect(generating).toContain("Brief is generating for this push");
    await harness.raw(
      "update generation set status = 'failed', error_code = 'provider-timeout', claims = 3, run_id = null, lease_expires_at = null",
    );
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload, { job: SECOND_ATTEMPT });

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.PROVIDER_TIMEOUT),
    ]);
  });

  it("never carries a failure's detail into the body", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const generator = stubGeneratorFailingOn(
      "brief",
      new GeneratorError(
        GeneratorErrorKinds.CONFIG,
        "apiKeyEnv ANTHROPIC_KEY_PROD is unset",
      ),
    );

    await makeTask({ github, generator })(payload);

    const bodies = readLiveBodies(github);
    expect(bodies).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.GENERATION_CONFIG),
    ]);
    expect(bodies.join("")).not.toContain("ANTHROPIC_KEY_PROD");
  });

  it("an at-cap retry over a failed row posts capped, never failed", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const spend = { maxGenerationsPerDay: 1 };
    const failing = stubGenerator();
    failing.failNextWith = makeConnectionError();
    await expect(
      makeTask({ github, generator: failing, spend })(payload, {
        job: FIRST_ATTEMPT,
      }),
    ).rejects.toThrow("Connection error");

    await makeTask({ github, spend })(payload, { job: LAST_ATTEMPT });

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    const [body] = readLiveBodies(github);
    expect(readLiveBodies(github)).toHaveLength(1);
    expect(body).toContain("reached its daily generation cap");
  });

  it("a later head's capped run replaces an older head's failed body", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const spend = { maxGenerationsPerDay: 1 };
    refuseDiffs(github);
    await makeTask({ github, spend })(first.payload);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await makeTask({ github, spend })(second.payload);

    expect(await readRowStatus(second.pr, HEAD_2)).toBe(
      GenerationStatuses.CAPPED,
    );
    const [body] = readLiveBodies(github);
    expect(readLiveBodies(github)).toHaveLength(1);
    expect(body).toContain("No brief for `bbbbbbb`");
    expect(body).toContain("reached its daily generation cap");
  });

  it("an unreadable live comment is left alone", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await makeTask({ github })(first.payload);
    const before = readLiveBodies(github);
    const callsBefore = listCommentCalls(github).length;

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    github.failOn("fetchComment", FakeFailures.SERVER_ERROR);
    refuseDiffs(github);
    const second = await trigger(HEAD_2);
    await makeTask({ github })(second.payload);

    const rerunCalls = listCommentCalls(github).slice(callsBefore);
    const fetches = rerunCalls.filter((call) => call.startsWith("fetch"));
    const deletes = rerunCalls.filter((call) => call.startsWith("delete"));
    expect(fetches).toHaveLength(1);
    expect(rerunCalls.some((call) => call === "post")).toBe(false);
    expect(deletes).toEqual([]);
    expect(readLiveBodies(github)).toEqual(before);
  });

  it("an identical failed body is not posted again", async () => {
    const github = makeGitHub(HEAD_1);
    refuseDiffs(github);
    const first = await trigger(HEAD_1);
    await makeTask({ github })(first.payload);
    const second = await trigger(HEAD_1);
    await makeTask({ github })(second.payload);

    const posts = listCommentCalls(github).filter((call) => call === "post");
    expect(posts).toHaveLength(1);
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.DIFF_TOO_LARGE),
    ]);
  });

  it("a rerun failing with another code replaces the earlier failed body", async () => {
    const github = makeGitHub(HEAD_1);
    const first = await trigger(HEAD_1);
    const misconfigured = stubGeneratorFailingOn(
      "brief",
      new GeneratorError(GeneratorErrorKinds.CONFIG, "model unset"),
    );
    await makeTask({ github, generator: misconfigured })(first.payload);
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.GENERATION_CONFIG),
    ]);

    refuseDiffs(github);
    const rerun = await trigger(HEAD_1);
    await makeTask({ github })(rerun.payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(rerun.pr, HEAD_1),
    );
    expect(row?.errorCode).toBe(GenerationFailureCodes.DIFF_TOO_LARGE);
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.DIFF_TOO_LARGE),
    ]);
  });

  it("a rerun failing before its PR read replaces the earlier failed body", async () => {
    const github = makeGitHub(HEAD_1);
    const first = await trigger(HEAD_1);
    refuseDiffs(github);
    await makeTask({ github })(first.payload);

    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
    const rerun = await trigger(HEAD_1);
    await expect(
      makeTask({ github })(rerun.payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("502");

    expect(await readRowStatus(rerun.pr, HEAD_1)).toBe(
      GenerationStatuses.FAILED,
    );
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.GITHUB_UNAVAILABLE),
    ]);
  });

  it("a last attempt failing on the first PR read replaces generating", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const first = stubGenerator();
    first.failNextWith = makeConnectionError();
    await expect(
      makeTask({ github, generator: first })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("Connection error");
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);

    await expect(
      makeTask({ github })(payload, { job: SECOND_ATTEMPT }),
    ).rejects.toThrow("502");
    const [generating] = readLiveBodies(github);
    expect(generating).toContain("Brief is generating for this push");

    await expect(
      makeTask({ github })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("502");

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.GITHUB_UNAVAILABLE),
    ]);
  });

  it("a pre-read failure leaves another head's on-demand body", async () => {
    const older = await trigger(HEAD_1);
    const newer = await trigger(HEAD_2, { requiresTriggerApproval: true });
    const github = makeGitHub(HEAD_2);
    await makeTask({ github })(newer.payload);
    const [onDemand] = readLiveBodies(github);
    expect(onDemand).toContain("Generate");
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);

    await expect(
      makeTask({ github })(older.payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("502");

    expect(await readRowStatus(older.pr, HEAD_1)).toBe(
      GenerationStatuses.FAILED,
    );
    expect(readLiveBodies(github)).toEqual([onDemand]);
  });

  it("a last attempt failing before any PR read creates no comment", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);

    await expect(
      makeTask({ github })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("502");

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(listCommentCalls(github)).toEqual([]);
  });

  it("a failure after a newer head took the comment over posts nothing", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const generator = stubGeneratorFailingAfter(async () => {
      await takeOverEntryComment(github, pr);
      github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    });

    await makeTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([NEWER_BODY]);
    expect(await readStoredCommentId(pr)).toBe(NEWER_COMMENT_ID);
  });

  it("a failure whose tracked comment another run replaced creates none", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const generator = stubGeneratorFailingAfter(() =>
      takeOverEntryComment(github, pr),
    );

    await makeTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([NEWER_BODY]);
    expect(await readStoredCommentId(pr)).toBe(NEWER_COMMENT_ID);
  });

  it("a failure after a push leaves its live generating body", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const generator = stubGeneratorFailingAfter(async () => {
      github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    });

    await makeTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    const [body] = readLiveBodies(github);
    expect(readLiveBodies(github)).toHaveLength(1);
    expect(body).toContain("Brief is generating for this push");
  });

  it("a failure whose row gained another run's comment creates none", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    refuseDiffs(github);
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async fetchDiff(prNumber) {
        await takeOverEntryComment(github, pr);
        return client.fetchDiff(prNumber);
      },
    }));

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([NEWER_BODY]);
    expect(await readStoredCommentId(pr)).toBe(NEWER_COMMENT_ID);
  });

  it("a failure after its own generating repost failed still posts", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await makeTask({ github })(first.payload);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    failFirstEntryPost(github);
    const second = await trigger(HEAD_2);
    const generator = stubGeneratorFailingOn(
      "brief",
      new GeneratorError(GeneratorErrorKinds.CONFIG, "bad model"),
    );

    await makeTask({ github, generator })(second.payload);

    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(
        HEAD_2,
        GenerationFailureCodes.GENERATION_CONFIG,
        FIRST_BRIEF_INDEX + 1,
      ),
    ]);
  });

  it("a capped run after a push leaves the older failed body", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const spend = { maxGenerationsPerDay: 1 };
    refuseDiffs(github);
    await makeTask({ github, spend })(first.payload);
    const olderFailed = readLiveBodies(github);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    pushHeadAfterFirstRead(github, NEWEST_HEAD);
    await makeTask({ github, spend })(second.payload);

    expect(await readRowStatus(second.pr, HEAD_2)).toBe(
      GenerationStatuses.CAPPED,
    );
    expect(readLiveBodies(github)).toEqual(olderFailed);
  });

  it("a run that cannot read its head leaves a newer head's Entry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await storeAnotherRunsEntry(github, pr.id, {
      id: NEWER_COMMENT_ID,
      body: NEWER_BODY,
    });
    failHeadReadsAfterFirst(github);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(readLiveBodies(github)).toEqual([NEWER_BODY]);
    expect(await readStoredCommentId(pr)).toBe(NEWER_COMMENT_ID);
  });

  it("a run whose ready-post head read fails still lands its ready body", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const generator = stubGeneratorUnreadingHeadAfterBrief(github);

    await makeTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    const [body] = readLiveBodies(github);
    expect(readLiveBodies(github)).toHaveLength(1);
    expect(body).toContain("Read the brief for this push");
  });

  it("a failure whose head read fails replaces its own generating body", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const generator = stubGeneratorFailingAfter(async () => {
      github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
    });

    await makeTask({ github, generator })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.PROVIDER_REFUSAL),
    ]);
  });

  it("a permanent failure replaces this head's capped body", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await trackCappedEntry(github, pr.id);
    refuseDiffs(github);

    await makeTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.DIFF_TOO_LARGE),
    ]);
  });

  it("a failure before the PR read replaces this head's capped body", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await trackCappedEntry(github, pr.id);
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);

    await expect(
      makeTask({ github })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("502");

    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.GITHUB_UNAVAILABLE),
    ]);
  });

  it("a failure before the PR read leaves this head's closed body", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const closed = buildEntryCommentClosedBody(t, HEAD_1);
    await trackEntryBody(github, pr.id, closed);
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);

    await expect(
      makeTask({ github })(payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("502");

    expect(readLiveBodies(github)).toEqual([closed]);
  });

  it("a failure whose head read fails replaces its own capped body", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await trackCappedEntry(github, pr.id);
    refuseDiffs(github);
    failHeadReadsAfterFirst(github);

    await makeTask({ github })(payload);

    expect(readLiveBodies(github)).toEqual([
      buildFailedBody(HEAD_1, GenerationFailureCodes.DIFF_TOO_LARGE),
    ]);
  });

  it("a failure that cannot read its head creates no Entry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await storeAnotherRunsEntry(github, pr.id, {
      id: NEWER_COMMENT_ID,
      body: NEWER_BODY,
    });
    github.removeComment(REPO, NEWER_COMMENT_ID);
    refuseDiffs(github);
    failHeadReadsAfterFirst(github);

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.FAILED);
    expect(readLiveBodies(github)).toEqual([]);
    expect(listCommentCalls(github)).not.toContain("post");
  });

  it("a capped run that cannot read its head leaves the Entry", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const spend = { maxGenerationsPerDay: 1 };
    refuseDiffs(github);
    await makeTask({ github, spend })(first.payload);
    const olderFailed = readLiveBodies(github);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    failHeadReadsAfterFirst(github);
    const { logger, readLines } = captureLogger();
    await makeTask({ github, spend, log: logger })(second.payload);

    expect(await readRowStatus(second.pr, HEAD_2)).toBe(
      GenerationStatuses.CAPPED,
    );
    expect(readLiveBodies(github)).toEqual(olderFailed);
    const standDown = readLines().find((line) =>
      String(line["msg"]).includes("the capped Entry stands down"),
    );
    expect(standDown?.["level"]).toBe("warn");
    expect(String(standDown?.["error"])).toContain("fetchPullRequest");
  });

  it("a failure beside a live holder stands down without a post", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const first = stubGenerator();
    first.failNextWith = makeConnectionError();
    await expect(
      makeTask({ github, generator: first })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("Connection error");
    const holderBodies = readLiveBodies(github);
    await harness.raw(
      "update generation set status = 'running', run_id = $1, lease_expires_at = now() + interval '2 minutes'",
      [HOLDER_RUN_ID],
    );
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);

    await makeTask({ github })(payload, { job: LAST_ATTEMPT });

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(row?.runId).toBe(HOLDER_RUN_ID);
    expect(readLiveBodies(github)).toEqual(holderBodies);
  });
});
