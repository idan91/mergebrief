// Integration tests for the `generate` task: real migrated PGlite schema (the
// `persistence/testing` harness, including the graphile_worker STUB), a stub
// Generator (no model calls), and an in-memory GitHub port (no network). The
// FIRST test drives the full enqueue→drain handshake: the payload the task
// consumes is read back from the stubbed jobs table exactly as
// `ingestRoutines.triggerGeneration` wrote it — pinning both sides of the
// contract in one place.
import { beforeEach, describe, expect, it } from "vitest";
import {
  artifactStore,
  forTenant,
  generationProjection,
  GenerationKind,
  GenerationStatus,
  ingestRoutines,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  parseTenantContext,
  PrState,
  type GenerationTarget,
  type PullRequestRow,
  type RepoId,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { APIConnectionError } from "@anthropic-ai/sdk";
import type { z } from "zod/v4";
import type { Effort, GenerateRequest, Generator } from "generators";
import type { Result } from "types";
import { createGenerateTask } from "../src/task/generate";
import type {
  GitHubApiError,
  GitHubPort,
  PullRequestFile,
  PullRequestInfo,
} from "../src/task/github-port";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const HEAD_1 = "a".repeat(40);
const HEAD_2 = "b".repeat(40);
const BASE = "c".repeat(40);
const PUBLIC_URL = "https://brief.example";

const SMALL_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
`;

/** 8 changed lines — huge against a 10-line whole-PR churn (ratio 0.8). */
const HUGE_DIFF = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,8 +1,8 @@
${"+x\n".repeat(8)}`;

function repoIdOf(value: bigint): RepoId {
  if (!isRepoId(value)) throw new Error("bad repo id");
  return value;
}
function reviewerIdOf(value: bigint): ReviewerId {
  if (!isReviewerId(value)) throw new Error("bad reviewer id");
  return value;
}

// ---------------------------------------------------------------------------
// Stub generator — dispatches canned, schema-minimal outputs by label.
// ---------------------------------------------------------------------------

interface StubGenerator extends Generator {
  readonly calls: string[];
  failNextWith?: unknown;
}

function stubGenerator(): StubGenerator {
  const calls: string[] = [];
  const outputs: Record<string, unknown> = {
    brief: { summary: "stub brief", changeGroups: [], chunks: [], concernView: [] },
    delta: {
      summary: "stub delta",
      commentsAddressed: "",
      changedGroups: [],
      chunks: [],
      wholePrImpact: "",
    },
    "revision narrative": { overview: "stub narrative", chunks: [] },
  };
  const generator: StubGenerator = {
    calls,
    async generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>> {
      if (generator.failNextWith !== undefined) {
        const failure = generator.failNextWith;
        generator.failNextWith = undefined;
        throw failure;
      }
      calls.push(req.label);
      const output = outputs[req.label];
      if (output === undefined) throw new Error(`no stub output for ${req.label}`);
      // Parsing through the request's own schema types the return without a
      // cast AND asserts the canned output is schema-valid (same trick as the
      // categorizer's FakeGenerator).
      return req.schema.parse(output);
    },
    provenance(effort: Effort) {
      return { provider: "stub", model: "stub-model", effort };
    },
  };
  return generator;
}

// ---------------------------------------------------------------------------
// Stub GitHub port.
// ---------------------------------------------------------------------------

interface StubGitHub extends GitHubPort {
  info: PullRequestInfo;
  files: PullRequestFile[];
  diff: string;
  /** Keyed `${base}...${head}`; missing spans fall back to SMALL_DIFF. */
  compareDiffs: Map<string, string>;
  /** Scripted head SHAs consumed per fetchPullRequest call; then info.headSha. */
  nextHeads: string[];
  fetchPullRequestError?: GitHubApiError;
  /** Live Entry comments by id (the delete+repost cycle's observable state). */
  comments: Map<bigint, string>;
  /** Every comment op in order: `post:<id>` / `delete:<id>`. */
  commentCalls: string[];
  postEntryCommentError?: GitHubApiError;
  deleteCommentError?: GitHubApiError;
  /** Test hook run after a successful post, before it returns (interleaving). */
  onPostEntryComment?: () => Promise<void>;
}

function ok<T>(value: T): Result<T, GitHubApiError> {
  return { ok: true, value };
}

function stubGitHub(headSha: string): StubGitHub {
  const stub: StubGitHub = {
    info: {
      headSha,
      baseSha: BASE,
      state: "open",
      draft: false,
      title: "stub PR",
      body: "",
      htmlUrl: "https://github.com/acme/widget/pull/7",
      commitCount: 3,
    },
    files: [{ path: "a.ts", additions: 8, deletions: 2 }],
    diff: SMALL_DIFF,
    compareDiffs: new Map(),
    nextHeads: [],
    comments: new Map(),
    commentCalls: [],
    async forPullRequest() {
      return {
        fetchPullRequest: async () => {
          if (stub.fetchPullRequestError) {
            return { ok: false, error: stub.fetchPullRequestError };
          }
          const scripted = stub.nextHeads.shift();
          return ok(scripted === undefined ? stub.info : { ...stub.info, headSha: scripted });
        },
        fetchPullRequestFiles: async () => ok(stub.files),
        fetchDiff: async () => ok(stub.diff),
        fetchCompareDiff: async (base: string, head: string) =>
          ok(stub.compareDiffs.get(`${base}...${head}`) ?? SMALL_DIFF),
        postEntryComment: async (body: string) => {
          if (stub.postEntryCommentError) {
            return { ok: false, error: stub.postEntryCommentError };
          }
          const commentId = BigInt(9000 + stub.comments.size + stub.commentCalls.length);
          stub.comments.set(commentId, body);
          stub.commentCalls.push(`post:${commentId}`);
          await stub.onPostEntryComment?.();
          return ok({ commentId });
        },
        deleteComment: async (commentId: bigint) => {
          if (stub.deleteCommentError) {
            return { ok: false, error: stub.deleteCommentError };
          }
          // Mirrors the real adapter: a 404 (unknown id) maps to ok.
          stub.comments.delete(commentId);
          stub.commentCalls.push(`delete:${commentId}`);
          return ok(undefined);
        },
      };
    },
  };
  return stub;
}

// ---------------------------------------------------------------------------
// Harness plumbing.
// ---------------------------------------------------------------------------

let harness: PgliteHarness;
let ctx: TenantContext;

beforeEach(async () => {
  harness = await createPgliteHarness();
  ctx = parseTenantContext({ installationId: 42 });
  return async () => {
    await harness.close();
  };
});

/** Enqueue via the REAL ingest seam and return {pr row, job payload}. */
async function trigger(headSha: string): Promise<{ pr: PullRequestRow; payload: unknown }> {
  const outcome = await ingestRoutines(harness.handle, ctx).triggerGeneration({
    pullRequest: {
      repoId: repoIdOf(7n),
      prNumber: 7,
      repoSlug: "acme/widget",
      state: PrState.OPEN,
    },
    headSha,
    debounceSeconds: 0,
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  const jobs = await harness.raw(
    "select payload from graphile_worker.jobs where task_identifier = 'generate'",
  );
  const payload = jobs.at(-1)?.["payload"];
  return { pr: outcome.value.pullRequest, payload };
}

function target(pr: PullRequestRow, headSha: string): GenerationTarget {
  if (!isPullRequestRowId(pr.id)) throw new Error("bad pr id");
  return { pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha, baselineSha: null };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("generate task", () => {
  it("drains the exact payload ingest enqueued: brief written, projection succeeded, audit emitted", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    await task(payload);

    const brief = await artifactStore(harness.handle, ctx).briefs.get(pr.id, BASE, HEAD_1);
    expect(brief).toBeDefined();
    expect(brief?.headIndex).toBe(1);
    expect(brief?.provider).toBe("stub");
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({ summary: "stub brief", index: 1 });

    const row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.SUCCEEDED);
    expect(row?.error).toBeNull();

    const audits = await harness.raw("select action, target_type from audit_log");
    expect(audits).toContainEqual({ action: "generate", target_type: "brief" });
    expect(generator.calls).toEqual(["brief"]);
  });

  it("posts the Entry comment with the exact-span deep link and stores its id", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    await task(payload);

    expect(github.comments.size).toBe(1);
    const [commentId, body] = [...github.comments.entries()][0] ?? [];
    expect(body).toContain(`${PUBLIC_URL}/repos/7/pulls/7?base=${BASE}&head=${HEAD_1}`);

    const row = await forTenant(harness.handle, ctx).pullRequests.getById(pr.id);
    expect(row?.entryCommentId).toBe(commentId);
  });

  it("posts a generating comment while the brief is produced, replaced on ready (delete+repost)", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    const inner = stubGenerator();
    // Capture the live comment at the moment the model call runs.
    let bodyDuringGeneration: string | undefined;
    const generator: Generator = {
      async generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>> {
        if (req.label === "brief") {
          bodyDuringGeneration = [...github.comments.values()][0];
        }
        return inner.generate(req);
      },
      provenance: (effort: Effort) => inner.provenance(effort),
    };
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    await task(payload);

    // While generating: the branded comment was already live, deep-linking the
    // wait screen for this exact span.
    expect(bodyDuringGeneration).toContain("generating");
    expect(bodyDuringGeneration).toContain(`${PUBLIC_URL}/repos/7/pulls/7?base=${BASE}&head=${HEAD_1}`);

    // On ready: delete+repost — exactly one comment left, the ready body.
    expect(github.comments.size).toBe(1);
    const [readyId, readyBody] = [...github.comments.entries()][0] ?? [];
    expect(readyBody).toContain("Read the Brief");
    expect(readyBody).not.toContain("generating");
    const row = await forTenant(harness.handle, ctx).pullRequests.getById(pr.id);
    expect(row?.entryCommentId).toBe(readyId);

    // Exact cycle: post generating → delete generating → post ready. The
    // delete must target the GENERATING comment's id (the in-run rotation),
    // never the stale pre-run stored id.
    const genId = github.commentCalls[0]?.slice("post:".length);
    expect(github.commentCalls).toEqual([`post:${genId}`, `delete:${genId}`, `post:${readyId}`]);
  });

  it("a rerun for an already-briefed head posts no generating comment", async () => {
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const afterFirstRun = github.commentCalls.length;
    const [readyId] = [...github.comments.entries()][0] ?? [];

    // Same head re-queued (review-submitted gap-filler / redelivery): the
    // brief is already stored, so no generation and no generating comment —
    // only the ready refresh.
    const second = await trigger(HEAD_1);
    await task(second.payload);

    const rerunCalls = github.commentCalls.slice(afterFirstRun);
    const [newReadyId] = [...github.comments.entries()][0] ?? [];
    expect(rerunCalls).toEqual([`delete:${readyId}`, `post:${newReadyId}`]);
    expect([...github.comments.values()][0]).toContain("Read the Brief");
  });

  it("second push replaces the Entry comment: old deleted, new posted, stored id rotated", async () => {
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const firstId = [...github.comments.keys()][0];
    expect(firstId).toBeDefined();

    github.info = { ...github.info, headSha: HEAD_2 };
    const second = await trigger(HEAD_2);
    await task(second.payload);

    // Never two comments; the survivor is the new one.
    expect(github.comments.size).toBe(1);
    const [secondId, body] = [...github.comments.entries()][0] ?? [];
    expect(secondId).not.toBe(firstId);
    expect(body).toContain(`head=${HEAD_2}`);
    expect(github.commentCalls).toContain(`delete:${firstId}`);

    const row = await forTenant(harness.handle, ctx).pullRequests.getById(second.pr.id);
    expect(row?.entryCommentId).toBe(secondId);
  });

  it("a superseded run posts nothing", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_2); // head advanced past the job's
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
    });

    await task(payload);

    expect(github.comments.size).toBe(0);
    expect(github.commentCalls).toEqual([]);
  });

  it("an Entry comment post failure logs and does not fail the job", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.postEntryCommentError = {
      code: "request-failed",
      status: 502,
      message: "failed to post entry comment: GitHub API returned status 502",
    };
    const logs: string[] = [];
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
      log: (message) => logs.push(message),
    });

    await task(payload);

    const row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.SUCCEEDED);
    expect((await forTenant(harness.handle, ctx).pullRequests.getById(pr.id))?.entryCommentId).toBeNull();
    expect(logs.some((line) => line.includes("entry comment post failed"))).toBe(true);
  });

  it("best-effort deletes the posted comment when storing its id fails (no untracked orphan)", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    // Interleave: the PR row vanishes between the READY post and its
    // setEntryComment (purge race) — the only way the id-store can fail. The
    // first post is the generating comment; the row must survive it (the
    // brief write needs the parent).
    let posts = 0;
    github.onPostEntryComment = async () => {
      posts += 1;
      if (posts === 2) {
        await harness.raw(`delete from pull_request where id = ${pr.id}`);
      }
    };
    const logs: string[] = [];
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
      log: (message) => logs.push(message),
    });

    await task(payload);

    // The untracked comment was cleaned up — no orphan survives for a later
    // run to post past.
    expect(github.comments.size).toBe(0);
    const lastPost = github.commentCalls.filter((call) => call.startsWith("post:")).at(-1);
    expect(lastPost).toBeDefined();
    const orphanId = lastPost?.slice("post:".length);
    // The cleanup delete follows the failed store — the run's final call.
    expect(github.commentCalls.at(-1)).toBe(`delete:${orphanId}`);
    expect(logs.some((line) => line.includes("entry comment id not stored"))).toBe(true);
  });

  it("an Entry comment delete failure skips the repost (never two comments) and keeps the stored id", async () => {
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const firstId = [...github.comments.keys()][0];

    github.info = { ...github.info, headSha: HEAD_2 };
    github.deleteCommentError = {
      code: "forbidden",
      status: 403,
      message: "failed to delete comment: GitHub API returned status 403",
    };
    const second = await trigger(HEAD_2);
    await task(second.payload);

    // The old comment survives alone; no second comment was posted past it.
    expect([...github.comments.keys()]).toEqual([firstId]);
    const row = await forTenant(harness.handle, ctx).pullRequests.getById(second.pr.id);
    expect(row?.entryCommentId).toBe(firstId);
    // The job itself still succeeded.
    const projection = await generationProjection(harness.handle, ctx).get(target(second.pr, HEAD_2));
    expect(projection?.status).toBe(GenerationStatus.SUCCEEDED);
  });

  it("marks superseded (attempts untouched, no generator call) when the head advanced", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_2); // GitHub's head moved past the job's
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    const projection = generationProjection(harness.handle, ctx);
    const before = await projection.get(target(pr, HEAD_1));

    await task(payload);

    const after = await projection.get(target(pr, HEAD_1));
    expect(after?.status).toBe(GenerationStatus.SUPERSEDED);
    expect(after?.attempts).toBe(before?.attempts);
    expect(generator.calls).toEqual([]);
  });

  it("marks superseded for a PR that went terminal after enqueue", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const setState = await forTenant(harness.handle, ctx).pullRequests.setState(pr.id, {
      state: PrState.CLOSED,
      closedAt: new Date(),
      purgeAfter: null,
    });
    expect(setState.ok).toBe(true);
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle, publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_1),
    });

    await task(payload);

    const row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.SUPERSEDED);
    expect(generator.calls).toEqual([]);
  });

  it("skips brief generation when the (base, head) brief already exists", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    await task(payload);
    await task(payload); // retry / redelivery

    expect(generator.calls).toEqual(["brief"]); // one spend, not two
  });

  it("writes marks + revision narrative against the previous briefed head", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });
    await task(first.payload);

    github.info = { ...github.info, headSha: HEAD_2 };
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = artifactStore(harness.handle, ctx);
    const brief2 = await store.briefs.get(second.pr.id, BASE, HEAD_2);
    expect(brief2?.headIndex).toBe(2);

    const marks = await store.comparisonMarks.get(second.pr.id, HEAD_1, HEAD_2);
    expect(marks).toBeDefined();
    expect(JSON.parse(marks?.body ?? "{}")).toMatchObject({
      baselineSha: HEAD_1,
      headSha: HEAD_2,
    });

    const narrative = await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2);
    expect(narrative).toBeDefined();
    expect(JSON.parse(narrative?.body ?? "{}")).toMatchObject({
      artifactKind: "revisionNarrative",
      prevIndex: 1,
      headIndex: 2,
    });
    expect(generator.calls).toEqual(["brief", "brief", "revision narrative"]);
  });

  it("pre-warms one delta core per distinct checkpoint SHA, with span marks", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });
    await task(first.payload);

    // Two reviewers sharing one checkpoint SHA → ONE delta core.
    const repo = forTenant(harness.handle, ctx);
    for (const reviewer of [100n, 200n]) {
      const written = await repo.checkpoints.upsertOnSubmit({
        pullRequestId: first.pr.id,
        reviewerId: reviewerIdOf(reviewer),
        lastSubmittedSha: HEAD_1,
        submittedAt: new Date(),
      });
      expect(written.ok).toBe(true);
    }

    github.info = { ...github.info, headSha: HEAD_2 };
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = artifactStore(harness.handle, ctx);
    const delta = await store.deltas.get(second.pr.id, HEAD_1, HEAD_2);
    expect(delta).toBeDefined();
    expect(JSON.parse(delta?.body ?? "{}")).toMatchObject({
      baselineSha: HEAD_1,
      headSha: HEAD_2,
      baselineIndex: 1,
    });
    // Checkpoint-span marks share the (HEAD_1, HEAD_2) span with the
    // previous-brief marks here — one content-addressed row.
    const marks = await store.comparisonMarks.get(second.pr.id, HEAD_1, HEAD_2);
    expect(marks).toBeDefined();
    expect(generator.calls.filter((label) => label === "delta")).toHaveLength(1);

    // Re-run: the stored delta short-circuits the span.
    await task(second.payload);
    expect(generator.calls.filter((label) => label === "delta")).toHaveLength(1);
  });

  it("skips the delta call on a huge span (full-brief fallback)", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });
    await task(first.payload);

    const written = await forTenant(harness.handle, ctx).checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: reviewerIdOf(100n),
      lastSubmittedSha: HEAD_1,
      submittedAt: new Date(),
    });
    expect(written.ok).toBe(true);

    github.info = { ...github.info, headSha: HEAD_2 };
    github.compareDiffs.set(`${HEAD_1}...${HEAD_2}`, HUGE_DIFF);
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = artifactStore(harness.handle, ctx);
    expect(await store.deltas.get(second.pr.id, HEAD_1, HEAD_2)).toBeUndefined();
    // The span marks are still there — the honest highlights survive the skip.
    expect(await store.comparisonMarks.get(second.pr.id, HEAD_1, HEAD_2)).toBeDefined();
    expect(generator.calls.filter((label) => label === "delta")).toHaveLength(0);
  });

  it("drops a malformed payload without touching the database", async () => {
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle, publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_1),
    });

    await expect(task({ nonsense: true })).resolves.toBeUndefined();
    expect(generator.calls).toEqual([]);
    expect(await harness.raw("select * from brief")).toHaveLength(0);
  });

  it("marks a permanent GitHub failure failed WITHOUT rethrowing (no graphile retry)", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.fetchPullRequestError = {
      code: "not-found",
      status: 404,
      message: "failed to fetch pull request: GitHub API returned status 404",
    };
    const task = createGenerateTask({
      handle: harness.handle, publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
    });

    await expect(task(payload)).resolves.toBeUndefined();

    const row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.FAILED);
    expect(row?.error).toContain("404");
  });

  it("marks a transient failure failed AND rethrows so graphile retries", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.fetchPullRequestError = {
      code: "request-failed",
      status: 502,
      message: "failed to fetch pull request: GitHub API returned status 502",
    };
    const task = createGenerateTask({
      handle: harness.handle, publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
    });

    await expect(task(payload)).rejects.toThrow("502");

    const row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.FAILED);
  });

  it("aborts a mid-stream generation on a superseding push: superseded, no retry, attempts untouched", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    // Initial pre-flight check sees the job's head; every poll after sees the
    // superseding push.
    github.nextHeads = [HEAD_1];
    github.info = { ...github.info, headSha: HEAD_2 };

    // The brief call hangs until the threaded signal aborts — the SDK-abort
    // shape (APIUserAbortError) the worker must map to superseded.
    const calls: string[] = [];
    const hangingGenerator: Generator = {
      async generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>> {
        calls.push(req.label);
        return new Promise<never>((_, reject) => {
          req.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" }));
          });
        });
      },
      provenance: (effort: Effort) => ({ provider: "stub", model: "stub-model", effort }),
    };

    const task = createGenerateTask({
      handle: harness.handle, publicBaseUrl: PUBLIC_URL,
      generator: hangingGenerator,
      github,
      headPollIntervalMs: 5,
    });

    const projection = generationProjection(harness.handle, ctx);
    const before = await projection.get(target(pr, HEAD_1));

    await expect(task(payload)).resolves.toBeUndefined(); // abort is NOT a job failure

    const after = await projection.get(target(pr, HEAD_1));
    expect(after?.status).toBe(GenerationStatus.SUPERSEDED);
    expect(after?.attempts).toBe(before?.attempts);
    expect(after?.error).toBeNull();
    expect(await artifactStore(harness.handle, ctx).briefs.get(pr.id, BASE, HEAD_1)).toBeUndefined();
  });

  it("supersedes before a delta spend when the head moves between artifact calls", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const written = await forTenant(harness.handle, ctx).checkpoints.upsertOnSubmit({
      pullRequestId: pr.id,
      reviewerId: reviewerIdOf(100n),
      lastSubmittedSha: "d".repeat(40),
      submittedAt: new Date(),
    });
    expect(written.ok).toBe(true);

    const github = stubGitHub(HEAD_1);
    // Pre-flight check passes; the pre-delta assertCurrent sees the new head.
    github.nextHeads = [HEAD_1];
    github.info = { ...github.info, headSha: HEAD_2 };
    const generator = stubGenerator();
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    await expect(task(payload)).resolves.toBeUndefined();

    // The brief (already generated and written) survives; the delta was
    // never spent; the projection ends superseded.
    expect(await artifactStore(harness.handle, ctx).briefs.get(pr.id, BASE, HEAD_1)).toBeDefined();
    expect(generator.calls).toEqual(["brief"]);
    const row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.SUPERSEDED);
  });

  it("classifies an SDK APIConnectionError as transient (rethrow for graphile retry)", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle, publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_1),
    });

    // The SDK's connection error carries NO status and name "Error" — only
    // an instanceof check can catch it (PR #29 review finding).
    generator.failNextWith = new APIConnectionError({});
    await expect(task(payload)).rejects.toThrow("Connection error");

    const row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.FAILED);
  });

  it("returns the job to the queue on graceful shutdown: no failed/superseded projection", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const shutdown = new AbortController();
    const calls: string[] = [];
    const hangingGenerator: Generator = {
      async generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>> {
        calls.push(req.label);
        // Abort the "worker process" once the stream is in flight.
        queueMicrotask(() => shutdown.abort());
        return new Promise<never>((_, reject) => {
          req.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" }));
          });
        });
      },
      provenance: (effort: Effort) => ({ provider: "stub", model: "stub-model", effort }),
    };
    const task = createGenerateTask({
      handle: harness.handle, publicBaseUrl: PUBLIC_URL,
      generator: hangingGenerator,
      github: stubGitHub(HEAD_1),
    });

    // Rethrows (graphile requeues) but writes NO terminal/failed status.
    await expect(task(payload, { abortSignal: shutdown.signal })).rejects.toThrow("aborted");

    const row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.RUNNING);
    expect(row?.error).toBeNull();
  });

  it("recovers the revision narrative on a retry that reuses the stored brief", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });
    await task(first.payload);

    github.info = { ...github.info, headSha: HEAD_2 };
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

    const store = artifactStore(harness.handle, ctx);
    expect(await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2)).toBeUndefined();

    // Retry: brief is reused, the Brief object is recovered from the stored
    // body, and the narrative is generated this time.
    await task(second.payload);
    const narrative = await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2);
    expect(narrative).toBeDefined();
    expect(JSON.parse(narrative?.body ?? "{}")).toMatchObject({
      artifactKind: "revisionNarrative",
    });
    // And a further retry does NOT re-spend on the narrative.
    const narrativeCallsBefore = generator.calls.filter((l) => l === "revision narrative").length;
    await task(second.payload);
    expect(generator.calls.filter((l) => l === "revision narrative")).toHaveLength(
      narrativeCallsBefore,
    );
  });

  it("sweeps a pre-drain-replaced head's projection to superseded after the newer head succeeds", async () => {
    const first = await trigger(HEAD_1); // queued row for head 1; job replaced below
    const second = await trigger(HEAD_2); // same job_key — payload now carries head 2
    expect(second.pr.id).toBe(first.pr.id);

    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle, publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_2),
    });
    await task(second.payload);

    const projection = generationProjection(harness.handle, ctx);
    const stale = await projection.get(target(first.pr, HEAD_1));
    expect(stale?.status).toBe(GenerationStatus.SUPERSEDED);
    const current = await projection.get(target(second.pr, HEAD_2));
    expect(current?.status).toBe(GenerationStatus.SUCCEEDED);
  });

  it("marks a transient generation error failed and rethrows; a deterministic one does not rethrow", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, publicBaseUrl: PUBLIC_URL, generator, github });

    const overloaded = Object.assign(new Error("Overloaded"), { status: 529 });
    generator.failNextWith = overloaded;
    await expect(task(payload)).rejects.toThrow("Overloaded");
    let row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.FAILED);

    generator.failNextWith = new Error("Model refused to produce the brief.");
    await expect(task(payload)).resolves.toBeUndefined();
    row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.FAILED);
    expect(row?.error).toContain("refused");
  });
});
