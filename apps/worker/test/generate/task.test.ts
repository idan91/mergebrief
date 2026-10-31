import { describe, expect, it, vi } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  createGenerationProjection,
  parseScopeContext,
} from "persistence";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { PrStates } from "types/pull-requests";
import type { z } from "zod/v4";
import {
  DEFAULT_LINK_FETCH,
  GeneratorError,
  GeneratorErrorKinds,
  type Effort,
  type GenerateRequest,
  type Generator,
} from "generators";
import { createI18n } from "i18n";
import { createLogger } from "logging";
import { RepoConfigPaths } from "repo-config";
import { createBuiltInContextProviders, type SharedRootDeps } from "brief-core";
import { STORED_BODY_VERSION } from "brief-core/artifact";
import type { AppClient, PullRequestInfo } from "github";
import { FakeFailures, type FakeGitHub } from "github/testing";
import {
  BASE,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  LAST_ATTEMPT,
  listCommentCalls,
  listRepoFilePaths,
  makeConnectionError,
  makeGitHub,
  makePullRequestInfo,
  makeRepoId,
  makeReviewerId,
  makeTarget,
  makeTask,
  PR_REF,
  pushHeadAfterFirstRead,
  PUBLIC_URL,
  recordCommentCalls,
  REPO,
  runAfterEachPost,
  runWithPullRequestsOffline,
  seedViewerGrant,
  setUpHarness,
  stubGenerator,
  stubMultiCallGenerator,
  stubHangingGenerator,
  trigger,
} from "./helpers";
import { TransientJobError } from "../../src/task/failure";
import { createGenerateTask } from "../../src/task/generate";
import {
  createAppGitHubBinders,
  createGitHubPort,
} from "../../src/task/github-port";

const NOTION_PAGE_ID = "3cf5e9400eeb81f9bed9e1474c2cb4d4";
const NOTION_SETTINGS =
  "version: 1\ntracker:\n  kind: notion\n  keyPrefix: BRIEF\n  databaseId: " +
  "a".repeat(32) +
  "\n";
const NOTION_ROOT = {
  env: { NOTION_TOKEN: "ntn_test_token_never_shown" },
  contextSources: [{ type: "notion" as const }],
};

/** A recorded Notion behind global fetch: one private page with one paragraph. */
function stubNotionFetch(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const routes: Record<string, unknown> = {
    [`/v1/pages/${NOTION_PAGE_ID}`]: {
      object: "page",
      id: NOTION_PAGE_ID,
      properties: {
        Name: { type: "title", title: [{ plain_text: "Secret roadmap" }] },
      },
    },
    [`/v1/blocks/${NOTION_PAGE_ID}/children`]: {
      object: "list",
      results: [
        {
          id: "b1",
          type: "paragraph",
          paragraph: {
            rich_text: [{ plain_text: "Not for the public brief." }],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    },
  };
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const body = routes[path];
    if (body === undefined) {
      return new Response("{}", { status: 404 });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { calls, restore: () => vi.unstubAllGlobals() };
}

function pointAtNotionPage(github: FakeGitHub): void {
  github.updatePullRequest(PR_REF, {
    body: `see https://www.notion.so/Roadmap-${NOTION_PAGE_ID}`,
  });
  github.addRepoFile(
    REPO,
    { path: RepoConfigPaths.SETTINGS },
    {
      kind: "file",
      content: NOTION_SETTINGS,
      blobSha: "sha-s",
      size: NOTION_SETTINGS.length,
    },
  );
}

/** `generator`, except the PR's head moves to HEAD_2 once the brief call returns. */
function pushHeadAfterBriefCall(
  generator: Generator,
  github: FakeGitHub,
): Generator {
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      const output = await generator.generate(req);
      if (req.label === "brief") {
        github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
      }
      return output;
    },
    origin: (effort: Effort) => generator.origin(effort),
  };
}

/** Another open PR in the repository, a stack neighbour of #7. */
function arrangeOpenPullRequest(
  github: FakeGitHub,
  prNumber: number,
  refs: Pick<PullRequestInfo, "title" | "headRef" | "baseRef">,
): void {
  github.addPullRequest(
    { ...REPO, prNumber },
    { info: { ...makePullRequestInfo(HEAD_2), ...refs } },
  );
}

setUpHarness();

/** An issue in another repo of the installation, which the PR author may not see. */
const SIBLING_ISSUE = {
  title: "Secret roadmap",
  state: "open",
  stateReason: null,
  labels: [],
  milestone: null,
  body: "Not for the public brief.",
  isPullRequest: false,
} as const;

describe("generate task", () => {
  it("reads and stamps the primary issue through the job's GitHub source", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { body: "fixes #7" });
    github.addIssue(
      { ...REPO, number: 7 },
      {
        title: "Stop the retry loop",
        state: "open",
        stateReason: null,
        labels: ["bug"],
        milestone: "v1",
        body: "The retry loop must stop after three attempts.",
        isPullRequest: false,
      },
    );
    const task = makeTask({ github });

    await task(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      intentCheck: {
        primaryTicket: {
          url: "https://github.com/acme/widget/issues/7",
          title: "Stop the retry loop",
          header: "open · bug · v1",
          status: "read",
          reason: "",
        },
      },
    });
  });

  it.each([false, true])(
    "keeps a url-box read in the PR's repo when siblingRepos is %s",
    async (siblingRepos) => {
      const ownerCtx = parseScopeContext({ ownerUserId: 555 });
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
      const payload = {
        owner_user_id: "555",
        grant_id: String(await seedViewerGrant()),
        pull_request_id: String(pr.id),
        head_sha: HEAD_1,
      };
      const github = makeGitHub(HEAD_1);
      github.updatePullRequest(PR_REF, {
        body: "fixes acme/private-tracker#42",
      });
      github.addIssue(
        { owner: "acme", repo: "private-tracker", number: 42 },
        SIBLING_ISSUE,
      );
      const task = makeTask({ github, siblingRepos });

      await task(payload);

      const brief = await createArtifactStore(
        harness.handle,
        ownerCtx,
      ).briefs.get(pr.id, BASE, HEAD_1);
      const body = brief?.body ?? "{}";
      expect(JSON.parse(body)).toMatchObject({
        intentCheck: {
          primaryTicket: { status: "unread", reason: "not-found" },
        },
      });
      expect(body).not.toContain("Secret roadmap");
    },
  );

  it("reads no sibling repo's issue for an installation job by default", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { body: "fixes acme/private-tracker#42" });
    github.addIssue(
      { owner: "acme", repo: "private-tracker", number: 42 },
      SIBLING_ISSUE,
    );

    await makeTask({ github })(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    const body = brief?.body ?? "{}";
    expect(JSON.parse(body)).toMatchObject({
      intentCheck: { primaryTicket: { status: "unread", reason: "not-found" } },
    });
    expect(body).not.toContain("Secret roadmap");
  });

  it("reads the configured issues repo for an installation job", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { body: "fixes #42" });
    github.addIssue(
      { owner: "acme", repo: "private-tracker", number: 42 },
      SIBLING_ISSUE,
    );
    const trackerRoot: SharedRootDeps = {
      env: {},
      contextSources: [],
      trackers: [{ kind: "github", issuesRepo: "acme/private-tracker" }],
    };

    await makeTask({ github, trackerRoot })(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      intentCheck: {
        primaryTicket: { status: "read", title: "Secret roadmap" },
      },
    });
  });

  it("reads a sibling repo's issue when the instance allows sibling repos", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { body: "fixes acme/private-tracker#42" });
    github.addIssue(
      { owner: "acme", repo: "private-tracker", number: 42 },
      SIBLING_ISSUE,
    );

    await makeTask({ github, siblingRepos: true })(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      intentCheck: {
        primaryTicket: { status: "read", title: "Secret roadmap" },
      },
    });
  });

  it("never offers a url-box job the deployment's Notion integration", async () => {
    const ownerCtx = parseScopeContext({ ownerUserId: 555 });
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
    const payload = {
      owner_user_id: "555",
      grant_id: String(await seedViewerGrant()),
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    };
    const github = makeGitHub(HEAD_1);
    pointAtNotionPage(github);
    const notion = stubNotionFetch();
    try {
      await makeTask({ github, trackerRoot: NOTION_ROOT })(payload);
    } finally {
      notion.restore();
    }

    const brief = await createArtifactStore(
      harness.handle,
      ownerCtx,
    ).briefs.get(pr.id, BASE, HEAD_1);
    expect(brief).toBeDefined();
    const body = brief?.body ?? "{}";
    expect(notion.calls).toEqual([]);
    // No Notion slot, so the page URL is never a ticket: no primary at all.
    expect(JSON.parse(body).intentCheck?.primaryTicket).toBeUndefined();
    expect(body).not.toContain("Secret roadmap");
  });

  it("reads a key on the instance's default board when the repo names none", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { body: "Fixes BRIEF-1" });
    const notion = stubNotionFetch();
    try {
      await makeTask({
        github,
        trackerRoot: {
          ...NOTION_ROOT,
          trackers: [
            { kind: "notion", keyPrefix: "BRIEF", databaseId: "a".repeat(32) },
          ],
        },
      })(payload);
    } finally {
      notion.restore();
    }

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(notion.calls[0]).toContain(`/v1/data_sources/${"a".repeat(32)}`);
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      intentCheck: {
        primaryTicket: { key: "BRIEF-1", tracker: "notion", status: "unread" },
      },
    });
  });

  it("reads installation-job Notion tickets through deployment credentials", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    pointAtNotionPage(github);
    const notion = stubNotionFetch();
    try {
      await makeTask({ github, trackerRoot: NOTION_ROOT })(payload);
    } finally {
      notion.restore();
    }

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(notion.calls).toEqual([
      `/v1/pages/${NOTION_PAGE_ID}`,
      `/v1/blocks/${NOTION_PAGE_ID}/children`,
    ]);
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      intentCheck: {
        primaryTicket: { status: "read", title: "Secret roadmap" },
      },
    });
  });

  it("drains ingest's payload into a stored brief, success state and audit", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const task = makeTask({ generator });

    await task(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(brief).toBeDefined();
    expect(brief?.headIndex).toBe(1);
    expect(brief?.provider).toBe("stub");
    expect(brief?.bodyVersion).toBe(STORED_BODY_VERSION);
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      summary: "stub brief",
      index: 1,
      // The PR lifecycle snapshot, pins the info→PrMetadata stamping
      // wiring, not just the widened interface.
      pr: {
        state: "open",
        draft: false,
        merged: false,
        headRef: "feature/stub",
        baseRef: "main",
      },
    });

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(row?.errorCode).toBeNull();

    const audits = await harness.raw(
      "select operation, target_type from audit_log",
    );
    expect(audits).toContainEqual({
      operation: "generate",
      target_type: "brief",
    });
    expect(generator.calls).toEqual(["brief"]);
  });

  it("stamps a linear open-PR stack onto the envelope", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { baseRef: "feature/a" });
    arrangeOpenPullRequest(github, 6, {
      title: "Parent",
      headRef: "feature/a",
      baseRef: "main",
    });
    arrangeOpenPullRequest(github, 8, {
      title: "Child",
      headRef: "feature/c",
      baseRef: "feature/stub",
    });
    const task = makeTask({ github });

    await task(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    const stack = {
      index: 2,
      members: [
        { number: 6, title: "Parent" },
        { number: 7, title: "stub PR" },
        { number: 8, title: "Child" },
      ],
    };
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      pr: { headRef: "feature/stub", baseRef: "feature/a", stack },
    });
    const row = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(pr.id);
    expect(row?.stack).toEqual(stack);
    expect(row?.stackReadAt).toBeInstanceOf(Date);
  });

  it("keeps the recorded ancestors a generation no longer sees", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const recorded = {
      members: [
        { number: 6, title: "Parent" },
        { number: 7, title: "stub PR" },
        { number: 8, title: "Child" },
      ],
      index: 2,
    };
    const recordedAt = new Date("2026-09-01T00:00:00Z");
    await createTenantRepository(harness.handle, ctx).pullRequests.recordStack(
      pr.id,
      { stack: recorded, readAt: recordedAt },
    );
    const github = makeGitHub(HEAD_1);
    arrangeOpenPullRequest(github, 8, {
      title: "Child",
      headRef: "feature/c",
      baseRef: "feature/stub",
    });
    const task = makeTask({ github });

    await task(payload);

    const row = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(pr.id);
    expect(row?.stack).toEqual(recorded);
    expect(row?.stackReadAt).toEqual(recordedAt);
  });

  it("omits stack and still stamps refs when the open list fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const priorStack = { members: [{ number: 7, title: "stub PR" }], index: 1 };
    const priorReadAt = new Date("2026-09-01T00:00:00Z");
    await createTenantRepository(harness.handle, ctx).pullRequests.recordStack(
      pr.id,
      { stack: priorStack, readAt: priorReadAt },
    );
    const github = makeGitHub(HEAD_1);
    github.failOn("listOpenPullRequests", FakeFailures.FORBIDDEN);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ github, log: logger });

    await task(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    const body = JSON.parse(brief?.body ?? "{}") as {
      pr?: Record<string, unknown>;
    };
    expect(body.pr?.["headRef"]).toBe("feature/stub");
    expect(body.pr?.["baseRef"]).toBe("main");
    expect("stack" in (body.pr ?? {})).toBe(false);
    expect(
      readLines().some(
        (line) => line["msg"] === "generate: open pull request list failed",
      ),
    ).toBe(true);
    const row = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(pr.id);
    expect(row?.stack).toEqual(priorStack);
    expect(row?.stackReadAt).toEqual(priorReadAt);
  });

  it("threads the instance-config effort into the stored brief's origin", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const task = makeTask({ effort: "low" });

    await task(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(brief?.effort).toBe("low");
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      generation: { provider: "stub", model: "stub-model", effort: "low" },
    });
  });

  it("stamps anchor origin `none` on the row and the artifact body", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const task = makeTask();

    await task(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(brief?.anchorState).toBe("none");
    expect(brief?.anchorReason).toBeNull();
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      anchor: { state: "none" },
    });
  });

  it("replaces the generating Entry with a ready notification", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const commentCalls = recordCommentCalls(github);
    const inner = stubGenerator();
    // Capture the live comment at the moment the model call runs.
    let bodyDuringGeneration: string | undefined;
    const generator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        if (req.label === "brief") {
          bodyDuringGeneration = [...github.readComments(REPO).values()][0];
        }
        return inner.generate(req);
      },
      origin: (effort: Effort) => inner.origin(effort),
    };
    const task = makeTask({ generator, github });

    await task(payload);

    // While generating: the branded comment was already live, deep-linking the
    // wait screen for this exact span.
    expect(bodyDuringGeneration).toContain("generating");
    expect(bodyDuringGeneration).toContain(
      `${PUBLIC_URL}/repos/7/pulls/7?rev=1`,
    );

    // On ready: delete+repost, exactly one comment left, the ready body.
    expect(github.readComments(REPO).size).toBe(1);
    const [readyId, readyBody] =
      [...github.readComments(REPO).entries()][0] ?? [];
    expect(readyBody).toContain("Read the brief");
    expect(readyBody).not.toContain("generating");
    const row = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(pr.id);
    expect(row?.entryCommentId).toBe(readyId);

    // Exact cycle: post generating → delete generating → post ready. The
    // delete must target the GENERATING comment's id (the in-run rotation),
    // never the stale pre-run stored id.
    const genId = commentCalls[0]?.slice("post:".length);
    expect(commentCalls).toEqual([
      `post:${genId}`,
      `delete:${genId}`,
      `post:${readyId}`,
    ]);
  });

  it("preserves an existing ready Entry on reruns without re-pinging", async () => {
    const github = makeGitHub(HEAD_1);
    const commentCalls = recordCommentCalls(github);
    const task = makeTask({ github });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const afterFirstRun = commentCalls.length;
    const [readyId] = [...github.readComments(REPO).entries()][0] ?? [];

    // The same head is enqueued again (review-submitted gap-filler or redelivery): the
    // brief is already stored and the ready comment is already live, the
    // rerun verifies the body via one fetch and posts NOTHING, delete+repost
    // here would re-ping the thread with no new information.
    const second = await trigger(HEAD_1);
    await task(second.payload);

    const rerunCalls = commentCalls.slice(afterFirstRun);
    expect(rerunCalls).toEqual([`fetch:${readyId}`]);
    expect(github.readComments(REPO).get(readyId ?? -1n)).toContain(
      "Read the brief",
    );
  });

  it("a rerun with a stuck generating comment still flips it to ready", async () => {
    const github = makeGitHub(HEAD_1);
    const commentCalls = recordCommentCalls(github);
    const task = makeTask({ github });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const [readyId] = [...github.readComments(REPO).entries()][0] ?? [];
    // Simulate a prior attempt that died before the ready flip: the live
    // comment still says "generating" for this head.
    if (readyId === undefined) {
      throw new Error("expected a live comment");
    }
    github.addComment(REPO, readyId, "Brief is generating for this push…");
    const afterFirstRun = commentCalls.length;

    const second = await trigger(HEAD_1);
    await task(second.payload);

    // Mismatch → the normal delete+repost self-heal runs.
    const rerunCalls = commentCalls.slice(afterFirstRun);
    const [newReadyId] = [...github.readComments(REPO).entries()][0] ?? [];
    expect(rerunCalls).toEqual([
      `fetch:${readyId}`,
      `delete:${readyId}`,
      `post:${newReadyId}`,
    ]);
    expect([...github.readComments(REPO).values()][0]).toContain(
      "Read the brief",
    );
  });

  it("a rerun whose tracked comment was manually deleted reposts it", async () => {
    const github = makeGitHub(HEAD_1);
    const commentCalls = recordCommentCalls(github);
    const task = makeTask({ github });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const [readyId] = [...github.readComments(REPO).entries()][0] ?? [];
    if (readyId === undefined) {
      throw new Error("expected a live comment");
    }
    // Someone deleted the Entry comment on GitHub; the stored id dangles.
    github.removeComment(REPO, readyId);
    const afterFirstRun = commentCalls.length;

    const second = await trigger(HEAD_1);
    await task(second.payload);

    // Gone (fetch → ok undefined) → the self-heal reposts; the 404-tolerant
    // delete of the dangling id precedes the post.
    const rerunCalls = commentCalls.slice(afterFirstRun);
    const [newReadyId] = [...github.readComments(REPO).entries()][0] ?? [];
    expect(rerunCalls).toEqual([
      `fetch:${readyId}`,
      `delete:${readyId}`,
      `post:${newReadyId}`,
    ]);
    expect([...github.readComments(REPO).values()][0]).toContain(
      "Read the brief",
    );
  });

  it("a rerun whose comment-body fetch fails falls back to the repost cycle", async () => {
    const github = makeGitHub(HEAD_1);
    const commentCalls = recordCommentCalls(github);
    const task = makeTask({ github });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const afterFirstRun = commentCalls.length;
    const [readyId] = [...github.readComments(REPO).entries()][0] ?? [];
    github.failOn("fetchComment", FakeFailures.SERVER_ERROR);

    const second = await trigger(HEAD_1);
    await task(second.payload);

    // Uncertainty never suppresses the flip: the delete+repost runs as before.
    const rerunCalls = commentCalls.slice(afterFirstRun);
    const [newReadyId] = [...github.readComments(REPO).entries()][0] ?? [];
    expect(rerunCalls).toEqual([`delete:${readyId}`, `post:${newReadyId}`]);
    expect([...github.readComments(REPO).values()][0]).toContain(
      "Read the brief",
    );
  });

  it("replaces the Entry on a second push and rotates its stored id", async () => {
    const github = makeGitHub(HEAD_1);
    const commentCalls = recordCommentCalls(github);
    const task = makeTask({ github });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const firstId = [...github.readComments(REPO).keys()][0];
    expect(firstId).toBeDefined();

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await task(second.payload);

    // Never two comments; the survivor is the new one.
    expect(github.readComments(REPO).size).toBe(1);
    const [secondId, body] = [...github.readComments(REPO).entries()][0] ?? [];
    expect(secondId).not.toBe(firstId);
    expect(body).toContain("?rev=2");
    expect(commentCalls).toContain(`delete:${firstId}`);

    const row = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(second.pr.id);
    expect(row?.entryCommentId).toBe(secondId);
  });

  it("an Entry comment post failure logs and does not fail the job", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.failOn("postEntryComment", FakeFailures.SERVER_ERROR);
    const logs: string[] = [];
    const task = makeTask({
      github,
      log: createLogger({
        env: {},
        destination: { write: (line: string) => void logs.push(line) },
      }),
    });

    await task(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(
      (
        await createTenantRepository(harness.handle, ctx).pullRequests.getById(
          pr.id,
        )
      )?.entryCommentId,
    ).toBeNull();
    expect(
      logs.some((line) => line.includes("entry comment post failed")),
    ).toBe(true);
  });

  it("best-effort deletes posted Entries when storing their ids fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const commentCalls = recordCommentCalls(github);
    // Interleave: the PR row vanishes between the READY post and its
    // swapEntryComment (purge race). The first post is the generating
    // comment; the row must survive it (the brief write needs the parent).
    let posts = 0;
    runAfterEachPost(github, async () => {
      posts += 1;
      if (posts === 2) {
        await harness.raw(`delete from pull_request where id = ${pr.id}`);
      }
    });
    const logs: string[] = [];
    const task = makeTask({
      github,
      log: createLogger({
        env: {},
        destination: { write: (line: string) => void logs.push(line) },
      }),
    });

    await task(payload);

    // The untracked comment was cleaned up, no orphan survives for a later
    // run to post past.
    expect(github.readComments(REPO).size).toBe(0);
    const lastPost = commentCalls
      .filter((call) => call.startsWith("post:"))
      .at(-1);
    expect(lastPost).toBeDefined();
    const orphanId = lastPost?.slice("post:".length);
    // The cleanup delete follows the failed store, the run's final call.
    expect(commentCalls.at(-1)).toBe(`delete:${orphanId}`);
    expect(
      logs.some((line) => line.includes("entry comment id not stored")),
    ).toBe(true);
  });

  it("retains the stored id and skips reposting when Entry deletion fails", async () => {
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ github });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const firstId = [...github.readComments(REPO).keys()][0];

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    github.failOn("deleteComment", FakeFailures.FORBIDDEN);
    const second = await trigger(HEAD_2);
    await task(second.payload);

    // The old comment survives alone; no second comment was posted past it.
    expect([...github.readComments(REPO).keys()]).toEqual([firstId]);
    const row = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(second.pr.id);
    expect(row?.entryCommentId).toBe(firstId);
    // The job itself still succeeded.
    const projection = await createGenerationProjection(
      harness.handle,
      ctx,
    ).get(makeTarget(second.pr, HEAD_2));
    expect(projection?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("supersedes advanced heads without attempts changes or generation", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_2); // GitHub's head moved past the job's
    const task = makeTask({ generator, github });

    const projection = createGenerationProjection(harness.handle, ctx);
    const before = await projection.get(makeTarget(pr, HEAD_1));

    await task(payload);

    const after = await projection.get(makeTarget(pr, HEAD_1));
    expect(after?.status).toBe(GenerationStatuses.SUPERSEDED);
    expect(after?.attempts).toBe(before?.attempts);
    expect(generator.calls).toEqual([]);
    expect(github.readComments(REPO).size).toBe(0);
    expect(listCommentCalls(github)).toEqual([]);
    // The App world schedules nothing here: the push's own webhook did.
    expect(await projection.get(makeTarget(pr, HEAD_2))).toBeUndefined();
  });

  it("marks superseded for a PR that went terminal after enqueue", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createTenantRepository(harness.handle, ctx).pullRequests.upsert({
      repoId: pr.repoId,
      prNumber: pr.prNumber,
      state: PrStates.CLOSED,
      closedAt: new Date(),
    });
    const generator = stubGenerator();
    const task = makeTask({ generator });

    await task(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUPERSEDED);
    expect(generator.calls).toEqual([]);
  });

  it("writes marks + revision narrative against the previous briefed head", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    // Non-default effort so the narrative-site threading is pinned too.
    const task = makeTask({ generator, github, effort: "low" });
    await task(first.payload);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const brief2 = await store.briefs.get(second.pr.id, BASE, HEAD_2);
    expect(brief2?.headIndex).toBe(2);

    const marks = await store.comparisonMarks.get(second.pr.id, HEAD_1, HEAD_2);
    expect(marks).toBeDefined();
    expect(JSON.parse(marks?.body ?? "{}")).toMatchObject({
      baselineSha: HEAD_1,
      headSha: HEAD_2,
    });

    const narrative = await store.revisionNarratives.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    expect(narrative).toBeDefined();
    expect(narrative?.bodyVersion).toBe(STORED_BODY_VERSION);
    const narrativeBody = JSON.parse(narrative?.body ?? "{}") as Record<
      string,
      unknown
    >;
    expect(narrativeBody).toMatchObject({
      artifactKind: "revisionNarrative",
      prevIndex: 1,
      headIndex: 2,
      generation: { effort: "low" },
    });
    // Pins the worker call-site wiring of `marksFiles`: the stub narrative
    // covers nothing, so the marks↔narrative coverage check must have run and
    // landed its warning in the persisted artifact.
    const narrativeWarnings = narrativeBody["generationWarnings"];
    expect(Array.isArray(narrativeWarnings)).toBe(true);
    expect(
      (narrativeWarnings as string[]).some((warning) =>
        warning.includes("revision narrative coverage"),
      ),
    ).toBe(true);
    expect(generator.calls).toEqual(["brief", "brief", "revision narrative"]);
  });

  it("pre-warms one delta core per distinct checkpoint SHA, with span marks", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    // Non-default effort so the delta-warm threading is pinned too.
    const task = makeTask({ generator, github, effort: "low" });
    await task(first.payload);

    // Two reviewers sharing one checkpoint SHA → ONE delta core.
    const repo = createTenantRepository(harness.handle, ctx);
    for (const reviewer of [100n, 200n]) {
      await repo.checkpoints.upsertOnSubmit({
        pullRequestId: first.pr.id,
        reviewerId: makeReviewerId(reviewer),
        lastSubmittedSha: HEAD_1,
        submittedAt: new Date(),
      });
    }

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const delta = await store.deltas.get(second.pr.id, HEAD_1, HEAD_2);
    expect(delta).toBeDefined();
    expect(delta?.bodyVersion).toBe(STORED_BODY_VERSION);
    expect(JSON.parse(delta?.body ?? "{}")).toMatchObject({
      baselineSha: HEAD_1,
      headSha: HEAD_2,
      baselineIndex: 1,
      generation: { effort: "low" },
    });
    // Checkpoint-span marks share the (HEAD_1, HEAD_2) span with the
    // previous-brief marks here, one content-addressed row.
    const marks = await store.comparisonMarks.get(second.pr.id, HEAD_1, HEAD_2);
    expect(marks).toBeDefined();
    expect(generator.calls.filter((label) => label === "delta")).toHaveLength(
      1,
    );

    // Re-run: the stored delta short-circuits the span.
    await task(second.payload);
    expect(generator.calls.filter((label) => label === "delta")).toHaveLength(
      1,
    );
  });

  it("drops a malformed payload without touching the database", async () => {
    const generator = stubGenerator();
    const task = makeTask({ generator });

    await expect(task({ nonsense: true })).resolves.toBeUndefined();
    expect(generator.calls).toEqual([]);
    expect(await harness.raw("select * from brief")).toHaveLength(0);
  });

  it("records permanent GitHub failures without rethrowing for retry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.failOn("fetchPullRequest", FakeFailures.NOT_FOUND);
    const task = makeTask({ github });

    await expect(task(payload)).resolves.toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    // Stamped at the GitHub throw site, the code, not prose, is the record.
    expect(row?.errorCode).toBe("github-access");
    expect(row?.errorParams).toBeNull();
  });

  it("aborts superseded streams without retry or attempts changes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);

    // The push lands once the brief call is in flight, which hangs until the
    // threaded signal aborts, the SDK-abort shape (APIUserAbortError) the
    // worker must map to superseded.
    const task = makeTask({
      generator: stubHangingGenerator(async () => {
        github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
      }),
      github,
      headPollIntervalMs: 5,
    });

    const projection = createGenerationProjection(harness.handle, ctx);
    const before = await projection.get(makeTarget(pr, HEAD_1));

    await expect(task(payload)).resolves.toBeUndefined(); // abort is NOT a job failure

    const after = await projection.get(makeTarget(pr, HEAD_1));
    expect(after?.status).toBe(GenerationStatuses.SUPERSEDED);
    expect(after?.attempts).toBe(before?.attempts);
    expect(after?.errorCode).toBeNull();
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        BASE,
        HEAD_1,
      ),
    ).toBeUndefined();
  });

  it("a push before the generating post supersedes without a post", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    pushHeadAfterFirstRead(github, HEAD_2);
    const generator = stubGenerator();

    await makeTask({ generator, github })(payload);

    expect(generator.calls).toEqual([]);
    expect(listCommentCalls(github)).toEqual([]);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUPERSEDED);
  });

  it("supersedes between artifacts before spending on a delta", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: "d".repeat(40),
      submittedAt: new Date(),
    });

    const github = makeGitHub(HEAD_1);
    // The push lands after the brief call; the next head check sees it.
    const generator = stubGenerator();
    const task = makeTask({
      generator: pushHeadAfterBriefCall(generator, github),
      github,
    });

    await expect(task(payload)).resolves.toBeUndefined();

    // The brief (already generated and written) survives; the delta was
    // never spent; the projection ends superseded.
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        BASE,
        HEAD_1,
      ),
    ).toBeDefined();
    expect(generator.calls).toEqual(["brief"]);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUPERSEDED);
  });

  it("rethrows provider connection errors as transient for graphile retry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const task = makeTask({ generator });

    generator.failNextWith = makeConnectionError();
    await expect(task(payload)).rejects.toThrow("Connection error");

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
  });

  it("requeues on shutdown and releases the claim without a failure", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const shutdown = new AbortController();
    const { logger, readLines } = captureLogger();
    // Abort the "worker process" once the stream is in flight.
    const task = makeTask({
      generator: stubHangingGenerator(async () => shutdown.abort()),
      log: logger,
    });

    // Rethrows (graphile requeues) but writes NO terminal/failed status.
    await expect(
      task(payload, { abortSignal: shutdown.signal }),
    ).rejects.toThrow("aborted");

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.PENDING);
    expect(row?.runId).toBeNull();
    expect(row?.leaseExpiresAt).toBeNull();
    expect(row?.errorCode).toBeNull();
    expect(row?.claims).toBe(1);
    const released = readLines().find((line) =>
      String(line["msg"]).includes("claim released on shutdown"),
    );
    expect(released?.["level"]).toBe("warn");
    expect(released?.["attempt"]).toBe(1);
    expect(released?.["maxAttempts"]).toBe(3);
  });

  it("a shutdown on the job's last attempt ends the row failed", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const shutdown = new AbortController();
    const task = makeTask({
      github,
      generator: stubHangingGenerator(async () => shutdown.abort()),
    });

    await expect(
      task(payload, { job: LAST_ATTEMPT, abortSignal: shutdown.signal }),
    ).rejects.toThrow("last attempt");

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.ATTEMPTS_EXHAUSTED);
    expect(row?.runId).toBeNull();
    const bodies = [...github.readComments(REPO).values()];
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(
      createI18n().t("entryComment.failed.reason.attempts-exhausted"),
    );
  });

  it("a shutdown during the revision narrative requeues the job", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ generator, github });
    await task(first.payload);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    const shutdown = new AbortController();
    const hanging = stubHangingGenerator(async () => shutdown.abort());
    const answer = generator.generate.bind(generator);
    generator.generate = async (req) => {
      if (req.label === "revision narrative") {
        return hanging.generate(req);
      }
      return answer(req);
    };
    await expect(
      task(second.payload, { abortSignal: shutdown.signal }),
    ).rejects.toThrow("aborted");

    const projection = createGenerationProjection(harness.handle, ctx);
    const target = makeTarget(second.pr, HEAD_2);
    expect((await projection.get(target))?.status).toBe(
      GenerationStatuses.PENDING,
    );

    generator.generate = answer;
    await task(second.payload);
    const store = createArtifactStore(harness.handle, ctx);
    expect(
      await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeDefined();
    expect((await projection.get(target))?.status).toBe(
      GenerationStatuses.SUCCEEDED,
    );
  });

  it("recovers a missing narrative while reusing the stored brief", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ generator, github });
    await task(first.payload);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    // First attempt: brief written, narrative call dies (non-fatal).
    const originalGenerate = generator.generate.bind(generator);
    let narrativeAttempts = 0;
    generator.generate = async (req) => {
      if (req.label === "revision narrative" && narrativeAttempts++ === 0) {
        throw new Error("Model refused to produce the revision narrative.");
      }
      return originalGenerate(req);
    };
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    expect(
      await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeUndefined();

    // Retry: brief is reused, the Brief object is recovered from the stored
    // body, and the narrative is generated this time.
    await task(second.payload);
    const narrative = await store.revisionNarratives.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    expect(narrative).toBeDefined();
    expect(JSON.parse(narrative?.body ?? "{}")).toMatchObject({
      artifactKind: "revisionNarrative",
    });
    // And a further retry does NOT re-spend on the narrative.
    const narrativeCallsBefore = generator.calls.filter(
      (label) => label === "revision narrative",
    ).length;
    await task(second.payload);
    expect(
      generator.calls.filter((label) => label === "revision narrative"),
    ).toHaveLength(narrativeCallsBefore);
  });

  it("reads the configured Notion ticket when retrying a stored narrative", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    pointAtNotionPage(github);
    const task = makeTask({ generator, github, trackerRoot: NOTION_ROOT });
    const firstNotion = stubNotionFetch();
    try {
      await task(first.payload);
    } finally {
      firstNotion.restore();
    }
    expect(firstNotion.calls).toHaveLength(2);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    const originalGenerate = generator.generate.bind(generator);
    let narrativeAttempts = 0;
    generator.generate = async (req) => {
      if (req.label === "revision narrative" && narrativeAttempts++ === 0) {
        throw new Error("Model refused to produce the revision narrative.");
      }
      return originalGenerate(req);
    };
    const secondNotion = stubNotionFetch();
    try {
      await task(second.payload);
    } finally {
      secondNotion.restore();
    }
    const store = createArtifactStore(harness.handle, ctx);
    expect(
      await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeUndefined();

    // Retry on the stored brief: the skip path loads repo config and reads
    // the Notion page again for the narrative, instead of GitHub's default.
    const retryNotion = stubNotionFetch();
    const fetchesBefore = listRepoFilePaths(github).length;
    try {
      await task(second.payload);
    } finally {
      retryNotion.restore();
    }
    expect(retryNotion.calls).toEqual([
      `/v1/pages/${NOTION_PAGE_ID}`,
      `/v1/blocks/${NOTION_PAGE_ID}/children`,
    ]);
    expect(listRepoFilePaths(github).length).toBeGreaterThan(fetchesBefore);
    expect(
      await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeDefined();

    // A further rerun spends nothing and so loads nothing: no config fetch.
    const settled = listRepoFilePaths(github).length;
    const idleNotion = stubNotionFetch();
    try {
      await task(second.payload);
    } finally {
      idleNotion.restore();
    }
    expect(idleNotion.calls).toEqual([]);
    expect(listRepoFilePaths(github).length).toBe(settled);
  });

  it("supersedes replaced projections after the newer head succeeds", async () => {
    const first = await trigger(HEAD_1); // pending row for head 1; job replaced below
    const second = await trigger(HEAD_2); // same job_key, payload now carries head 2
    expect(second.pr.id).toBe(first.pr.id);

    const task = makeTask({ github: makeGitHub(HEAD_2) });
    await task(second.payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const stale = await projection.get(makeTarget(first.pr, HEAD_1));
    expect(stale?.status).toBe(GenerationStatuses.SUPERSEDED);
    const current = await projection.get(makeTarget(second.pr, HEAD_2));
    expect(current?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("a last attempt whose first read throws keeps the briefed row", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await makeTask({ github })(payload);
    const task = makeTask({ github });

    const run = runWithPullRequestsOffline(() =>
      task(payload, { job: LAST_ATTEMPT }),
    );
    await expect(run).rejects.toThrow("Failed query");

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("a push after the last head check keeps its pending row", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    // The ready Entry is the run's second post and follows its last head
    // check; the stub's head never moves, so the run cannot see this push.
    let posts = 0;
    runAfterEachPost(github, async () => {
      posts += 1;
      if (posts === 2) {
        await trigger(HEAD_2);
        // Postdates the run's pickup whatever the clock's resolution.
        await harness.raw(
          "update generation set updated_at = updated_at + interval '1 minute' where head_sha = $1",
          [HEAD_2],
        );
      }
    });
    const task = makeTask({ github });

    await task(first.payload);

    expect(posts).toBe(2);
    const projection = createGenerationProjection(harness.handle, ctx);
    const finished = await projection.get(makeTarget(first.pr, HEAD_1));
    expect(finished?.status).toBe(GenerationStatuses.SUCCEEDED);
    const pushed = await projection.get(makeTarget(first.pr, HEAD_2));
    expect(pushed?.status).toBe(GenerationStatuses.PENDING);
  });

  it("a refused installation token mint is transient for graphile's retry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const refusingApp = {
      getInstallationOctokit: () => Promise.reject(new Error("mint refused")),
    } as unknown as AppClient;
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      translate: createI18n().t,
      generator,
      contextProviders: createBuiltInContextProviders(DEFAULT_LINK_FETCH),
      github: createGitHubPort(createAppGitHubBinders(refusingApp)),
    });

    await expect(task(payload)).rejects.toThrow(TransientJobError);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.GITHUB_UNAVAILABLE);
    expect(generator.calls).toEqual([]);
  });

  it("fails for good as output-cut when the multi-call re-run is cut too", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubMultiCallGenerator(["brief", "grouping"]);

    await expect(makeTask({ generator })(payload)).resolves.toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(generator.calls).toEqual(["brief", "grouping"]);
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.OUTPUT_CUT);
  });

  it("re-runs a cut single call as a multi-call run and stores the brief", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubMultiCallGenerator(["brief"]);

    await makeTask({ generator })(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    const body = JSON.parse(brief?.body ?? "{}");
    expect(generator.calls).toEqual(["brief", "grouping", "detail:1"]);
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(body).toMatchObject({
      outlineForm: "full",
      chunks: [{ file: "a.ts", changeGroupId: "g1" }],
    });
    expect(body.generationWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining("multi-call run")]),
    );
  });

  it("fails a spend-limited brief for good, with no retry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.failNextWith = new GeneratorError(
      GeneratorErrorKinds.PROVIDER_SPEND_LIMIT,
      "429 spend limit reached",
    );

    await expect(makeTask({ generator })(payload)).resolves.toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.errorCode).toBe(GenerationFailureCodes.PROVIDER_SPEND_LIMIT);
  });

  it("rethrows transient failures but retains deterministic ones as failed", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const task = makeTask({ generator });

    const overloaded = Object.assign(new Error("Overloaded"), { status: 529 });
    generator.failNextWith = overloaded;
    await expect(task(payload)).rejects.toThrow("Overloaded");
    let row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);

    generator.failNextWith = new Error("Model refused to produce the brief.");
    await expect(task(payload)).resolves.toBeUndefined();
    row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    // A plain-Error refusal has no stamp and no taxonomy, unknown{detail}.
    expect(row?.errorCode).toBe("unknown");
    expect(row?.errorParams).toMatchObject({
      detail: expect.stringContaining("refused"),
    });
  });
});
