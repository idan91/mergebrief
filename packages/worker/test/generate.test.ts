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
import type { z } from "zod/v4";
import type { Effort, GenerateRequest, Generator } from "categorizer";
import type { Result } from "types";
import { createGenerateTask } from "../src/generate";
import type {
  GitHubApiError,
  GitHubPort,
  PullRequestFile,
  PullRequestInfo,
} from "../src/github-port";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const HEAD_1 = "a".repeat(40);
const HEAD_2 = "b".repeat(40);
const BASE = "c".repeat(40);

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
    const task = createGenerateTask({ handle: harness.handle, generator, github });

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

  it("marks superseded (attempts untouched, no generator call) when the head advanced", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_2); // GitHub's head moved past the job's
    const task = createGenerateTask({ handle: harness.handle, generator, github });

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
      handle: harness.handle,
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
    const task = createGenerateTask({ handle: harness.handle, generator, github });

    await task(payload);
    await task(payload); // retry / redelivery

    expect(generator.calls).toEqual(["brief"]); // one spend, not two
  });

  it("writes marks + revision narrative against the previous briefed head", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, generator, github });
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
    const task = createGenerateTask({ handle: harness.handle, generator, github });
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
    const task = createGenerateTask({ handle: harness.handle, generator, github });
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
      handle: harness.handle,
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
      handle: harness.handle,
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
      handle: harness.handle,
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
      handle: harness.handle,
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
    const task = createGenerateTask({ handle: harness.handle, generator, github });

    await expect(task(payload)).resolves.toBeUndefined();

    // The brief (already generated and written) survives; the delta was
    // never spent; the projection ends superseded.
    expect(await artifactStore(harness.handle, ctx).briefs.get(pr.id, BASE, HEAD_1)).toBeDefined();
    expect(generator.calls).toEqual(["brief"]);
    const row = await generationProjection(harness.handle, ctx).get(target(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatus.SUPERSEDED);
  });

  it("marks a transient generation error failed and rethrows; a deterministic one does not rethrow", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({ handle: harness.handle, generator, github });

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
