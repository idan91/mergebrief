// Use migrated PGlite, a graphile queue stub and fake model/GitHub ports without network.
// The first test drains the exact payload ingest wrote, pinning the enqueue/drain contract.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  createGenerationProjection,
  GenerationKinds,
  GenerationStatuses,
  createIngestRoutines,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  parseScopeContext,
  parseTenantContext,
  PrStates,
  type GenerationTarget,
  type PullRequestRow,
  type RepoId,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { APIConnectionError } from "@anthropic-ai/sdk";
import type { z } from "zod/v4";
import {
  GeneratorError,
  GeneratorErrorKinds,
  type Effort,
  type GenerateRequest,
  type Generator,
} from "generators";
import { createLogger } from "logging";
import type { Mutable, Result } from "types";
import {
  CUSTOM_ATTRIBUTE_NAME_PATTERN,
  INSTRUCTIONS_INJECTION_BUDGET_BYTES,
  PARKED_ATTRIBUTE_CANDIDATES as CAT_PARKED,
  RESERVED_ATTRIBUTE_WORDS as CAT_RESERVED,
  type ContextProvider,
  type ContextQuery,
} from "brief-core";
import {
  ATTRIBUTE_NAME_PATTERN,
  INSTRUCTIONS_BUDGET_BYTES,
  PARKED_ATTRIBUTE_CANDIDATES,
  RepoConfigPaths,
  repoConfigArtifactSchema,
  repoConfigOriginSchema,
  RESERVED_ATTRIBUTE_WORDS,
} from "repo-config";
import {
  createGenerateTask,
  type GenerateTaskDeps,
} from "../src/task/generate";
import type { CompareFile } from "brief-core";
import { GitHubApiErrorCodes } from "github";
import type {
  GitHubApiError,
  GitHubPort,
  IssueInfo,
  OpenPullRequest,
  PullRequestFile,
  PullRequestSource,
  PullRequestInfo,
  RepoFileResult,
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

/** 8 changed lines, huge against a 10-line whole-PR churn (ratio 0.8). */
const HUGE_DIFF = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,8 +1,8 @@
${"+x\n".repeat(8)}`;

function makeRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) throw new Error("bad repo id");
  return value;
}
function makeReviewerId(value: bigint): ReviewerId {
  if (!isReviewerId(value)) throw new Error("bad reviewer id");
  return value;
}

// ---------------------------------------------------------------------------
// Stub generator, dispatches canned, schema-minimal outputs by label.
// ---------------------------------------------------------------------------

interface StubGenerator extends Generator {
  readonly calls: string[];
  /** Canned outputs by label, tests may override an entry. */
  readonly outputs: Record<string, unknown>;
  /** Every request's prompt surfaces, for injection assertions. */
  readonly requests: { label: string; system: string; user: string }[];
  failNextWith?: unknown;
}

function stubGenerator(): StubGenerator {
  const calls: string[] = [];
  const requests: { label: string; system: string; user: string }[] = [];
  const outputs: Record<string, unknown> = {
    // Coverage-valid by default: the anchored path's hard coverage check
    // requires every PR file (stub default: a.ts) in exactly one group.
    brief: {
      summary: "stub brief",
      intentCheck: {
        ticketUrls: [],
        ticketTitles: [],
        specificity: "none",
        scopeNote: "",
        items: [],
        alignment: { read: "", goal: "", response: "" },
      },
      changeGroups: [
        {
          id: "g1",
          title: "stub group",
          summary: "stub group summary",
          dominantCategory: "bugfix",
          secondaryCategories: [],
          uncertain: false,
          uncertainBetween: [],
        },
      ],
      chunks: [
        {
          id: "c1",
          changeGroupId: "g1",
          file: "a.ts",
          concern: "implementation",
          role: "core",
          loc: { added: 1, deleted: 0 },
          addedRanges: [{ start: 2, end: 2 }],
          removedRanges: [],
          riskSurface: [],
        },
      ],
      concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
    },
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
    outputs,
    requests,
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      if (generator.failNextWith !== undefined) {
        const failure = generator.failNextWith;
        generator.failNextWith = undefined;
        throw failure;
      }
      calls.push(req.label);
      requests.push({ label: req.label, system: req.system, user: req.user });
      const output = outputs[req.label];
      if (output === undefined)
        throw new Error(`no stub output for ${req.label}`);
      // Parsing through the request's own schema types the return without a
      // cast AND asserts the canned output is schema-valid.
      return req.schema.parse(output);
    },
    origin(effort: Effort) {
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
  /**
   * Keyed `${base}...${head}`; missing spans fall back to the conservative
   * `{files: [], complete: false}` (nothing confirmable, all re-look).
   */
  compareFiles: Map<
    string,
    { files: CompareFile[]; complete: boolean; status?: string }
  >;
  /** Scripted head SHAs consumed per fetchPullRequest call; then info.headSha. */
  nextHeads: string[];
  fetchPullRequestError?: GitHubApiError;
  /** Scripted compare-files failure; anchoring must degrade, not fail. */
  fetchCompareFilesError?: GitHubApiError;
  /** Live Entry comments by id (the delete+repost cycle's observable state). */
  comments: Map<bigint, string>;
  /** Every comment op in order: `post:<id>` / `delete:<id>`. */
  commentCalls: string[];
  postEntryCommentError?: GitHubApiError;
  deleteCommentError?: GitHubApiError;
  fetchCommentError?: GitHubApiError;
  /** Test hook run after a successful post, before it returns (interleaving). */
  onPostEntryComment?: () => Promise<void>;
  /** Repo-config files by path; missing = absent (404). */
  repoFiles: Map<string, RepoFileResult>;
  /** Per-path scripted fetchRepoFile failures. */
  repoFileErrors: Map<string, GitHubApiError>;
  /** Every fetchRepoFile path requested, in order. */
  repoFileCalls: string[];
  /** Every openUrlBoxPullRequestSource binding, in order. */
  urlBoxCalls: { grantId: bigint; repoSlug: string; prNumber: number }[];
  /** Issues by `owner/repo#n`; missing = not found (404). */
  issues: Map<string, IssueInfo>;
  /** Open PRs in the repo; empty means no stack. */
  openPullRequests: OpenPullRequest[];
  listOpenPullRequestsError?: GitHubApiError;
}

function ok<T>(value: T): Result<T, GitHubApiError> {
  return { ok: true, value };
}

function stubGitHub(headSha: string): StubGitHub {
  const stub: StubGitHub = {
    info: {
      repoId: makeRepoId(7n),
      repoFullName: "acme/widget",
      headSha,
      headRef: "feature/stub",
      baseRef: "main",
      baseSha: BASE,
      state: "open",
      draft: false,
      merged: false,
      title: "stub PR",
      body: "",
      htmlUrl: "https://github.com/acme/widget/pull/7",
      commitCount: 3,
      authorLogin: "octocat",
      closedAt: null,
      headRepo: { owner: "acme", repo: "widget" },
      baseRepo: { owner: "acme", repo: "widget" },
    },
    files: [{ path: "a.ts", additions: 8, deletions: 2 }],
    diff: SMALL_DIFF,
    compareDiffs: new Map(),
    compareFiles: new Map(),
    nextHeads: [],
    comments: new Map(),
    commentCalls: [],
    repoFiles: new Map(),
    repoFileErrors: new Map(),
    repoFileCalls: [],
    urlBoxCalls: [],
    issues: new Map(),
    openPullRequests: [],
    async openPullRequestSource() {
      return buildSource();
    },
    async openUrlBoxPullRequestSource(grantId, repoSlug, prNumber) {
      stub.urlBoxCalls.push({ grantId, repoSlug, prNumber });
      return buildSource();
    },
  };
  function buildSource(): PullRequestSource {
    return {
      fetchPullRequest: async () => {
        if (stub.fetchPullRequestError) {
          return { ok: false, error: stub.fetchPullRequestError };
        }
        const scripted = stub.nextHeads.shift();
        return ok(
          scripted === undefined
            ? stub.info
            : { ...stub.info, headSha: scripted },
        );
      },
      fetchPullRequestFiles: async () => ok(stub.files),
      listOpenPullRequests: async () => {
        if (stub.listOpenPullRequestsError) {
          return { ok: false, error: stub.listOpenPullRequestsError };
        }
        return ok(stub.openPullRequests);
      },
      fetchIssue: async (owner: string, repo: string, number: number) => {
        const issue = stub.issues.get(`${owner}/${repo}#${number}`);
        if (issue === undefined) {
          return {
            ok: false,
            error: {
              code: "not-found",
              status: 404,
              message: "failed to fetch issue: GitHub API returned status 404",
            },
          };
        }
        return ok(issue);
      },
      fetchDiff: async () => ok(stub.diff),
      fetchCompareDiff: async (base: string, head: string) =>
        ok(stub.compareDiffs.get(`${base}...${head}`) ?? SMALL_DIFF),
      fetchCompareFiles: async (base: string, head: string) => {
        if (stub.fetchCompareFilesError) {
          return { ok: false, error: stub.fetchCompareFilesError };
        }
        return ok(
          stub.compareFiles.get(`${base}...${head}`) ?? {
            files: [],
            complete: false,
          },
        );
      },
      fetchRepoFile: async (path: string) => {
        stub.repoFileCalls.push(path);
        const scripted = stub.repoFileErrors.get(path);
        if (scripted !== undefined) {
          return { ok: false, error: scripted };
        }
        return ok(stub.repoFiles.get(path) ?? { kind: "absent" as const });
      },
      postEntryComment: async (body: string) => {
        if (stub.postEntryCommentError) {
          return { ok: false, error: stub.postEntryCommentError };
        }
        const commentId = BigInt(
          9000 + stub.comments.size + stub.commentCalls.length,
        );
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
      fetchComment: async (commentId: bigint) => {
        if (stub.fetchCommentError) {
          return { ok: false, error: stub.fetchCommentError };
        }
        stub.commentCalls.push(`fetch:${commentId}`);
        const body = stub.comments.get(commentId);
        // Mirrors the real adapter: a 404 (unknown id) maps to ok undefined.
        return ok(body === undefined ? undefined : { body });
      },
    };
  }
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

/** Enqueue via the REAL ingest boundary and return {pr row, job payload}. */
async function trigger(
  headSha: string,
): Promise<{ pr: PullRequestRow; payload: unknown }> {
  const outcome = await createIngestRoutines(
    harness.handle,
    ctx,
  ).triggerGeneration({
    pullRequest: {
      repoId: makeRepoId(7n),
      prNumber: 7,
      repoSlug: "acme/widget",
      state: PrStates.OPEN,
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
  return {
    pullRequestId: pr.id,
    kind: GenerationKinds.BRIEF,
    headSha,
    baselineSha: null,
  };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

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
    if (body === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { calls, restore: () => vi.unstubAllGlobals() };
}

function pointAtNotionPage(github: StubGitHub): void {
  github.info = {
    ...github.info,
    body: `see https://www.notion.so/Roadmap-${NOTION_PAGE_ID}`,
  };
  github.repoFiles.set(RepoConfigPaths.SETTINGS, {
    kind: "file",
    content: NOTION_SETTINGS,
    blobSha: "sha-s",
    size: NOTION_SETTINGS.length,
  });
}

describe("generate task, url-box world", () => {
  it("drains url-box jobs with owner scope and viewer reads, without Entries", async () => {
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
    // The queued projection row the enqueue door writes (PR-3 side of the
    // handshake), the drain transitions it, never creates it.
    const queued = await createGenerationProjection(
      harness.handle,
      ownerCtx,
    ).upsertQueued(target(pr, HEAD_1));
    expect(queued.ok).toBe(true);
    const payload = {
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    };
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    // The credential path: the grant reference reached the port, and the
    // installation binding was never asked for.
    expect(github.urlBoxCalls).toEqual([
      { grantId: 31n, repoSlug: "acme/widget", prNumber: 7 },
    ]);

    const brief = await createArtifactStore(
      harness.handle,
      ownerCtx,
    ).briefs.get(pr.id, BASE, HEAD_1);
    expect(brief).toBeDefined();
    expect(brief?.installationId).toBeNull();

    const row = await createGenerationProjection(harness.handle, ownerCtx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);

    // The viewer's token must never write to GitHub: no comment ops at all.
    expect(github.commentCalls).toEqual([]);
    expect(
      (
        await createTenantRepository(
          harness.handle,
          ownerCtx,
        ).pullRequests.getById(pr.id)
      )?.entryCommentId,
    ).toBeNull();

    const audits = await harness.raw(
      "select installation_id, source, operation, target_type from audit_log",
    );
    expect(audits).toContainEqual({
      installation_id: null,
      source: "url-box",
      operation: "generate",
      target_type: "brief",
    });
  });

  it("queries the context providers main.ts injected with the PR's metadata", async () => {
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
    const projection = createGenerationProjection(harness.handle, ownerCtx);
    expect((await projection.upsertQueued(target(pr, HEAD_1))).ok).toBe(true);
    const queries: ContextQuery[] = [];
    const provider: ContextProvider = {
      providerId: "url",
      fetch: async (query) => {
        queries.push(query);
        return { ok: true, value: [] };
      },
    };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github: stubGitHub(HEAD_1),
      contextProviders: [provider],
    });

    await task({
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      title: "stub PR",
      headRef: "feature/stub",
      repo: { owner: "acme", repo: "widget" },
    });
  });

  it("requeues the observed head when a url-box PR moves before draining", async () => {
    // No installation means no webhook: if this run only stood down, the
    // paste would end with no brief and nothing scheduled.
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
    const projection = createGenerationProjection(harness.handle, ownerCtx);
    expect((await projection.upsertQueued(target(pr, HEAD_1))).ok).toBe(true);
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_2),
    });

    await task({
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    expect(generator.calls).toEqual([]);
    expect((await projection.get(target(pr, HEAD_1)))?.status).toBe(
      GenerationStatuses.SUPERSEDED,
    );
    expect((await projection.get(target(pr, HEAD_2)))?.status).toBe(
      GenerationStatuses.QUEUED,
    );
    const jobs = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["payload"]).toMatchObject({
      owner_user_id: "555",
      grant_id: "31",
      head_sha: HEAD_2,
    });
  });

  it("re-queues the observed head when a url-box PR moves MID-generation", async () => {
    // The mid-stream poller aborts the SDK call, which surfaces as an abort
    // rather than a head mismatch, the follow-up must ride that path too.
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
    const projection = createGenerationProjection(harness.handle, ownerCtx);
    expect((await projection.upsertQueued(target(pr, HEAD_1))).ok).toBe(true);
    const github = stubGitHub(HEAD_1);
    // The pre-flight read sees the job's head; every poll after it sees the
    // push that supersedes this run.
    github.nextHeads = [HEAD_1];
    github.info = { ...github.info, headSha: HEAD_2 };
    const hangingGenerator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        return new Promise<never>((_, reject) => {
          req.signal?.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("Request was aborted."), {
                name: "APIUserAbortError",
              }),
            );
          });
        });
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: hangingGenerator,
      github,
      headPollIntervalMs: 5,
    });

    await task({
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    expect((await projection.get(target(pr, HEAD_1)))?.status).toBe(
      GenerationStatuses.SUPERSEDED,
    );
    expect((await projection.get(target(pr, HEAD_2)))?.status).toBe(
      GenerationStatuses.QUEUED,
    );
    const jobs = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["payload"]).toMatchObject({
      owner_user_id: "555",
      grant_id: "31",
      head_sha: HEAD_2,
    });
  });

  it("queues the successor from the read it already made, not a fresh one", async () => {
    // Every GitHub read after the abort fails. The follow-up must still queue
    // HEAD_2 off the read the watch already made, re-reading here would
    // finalize `superseded` with nothing scheduled, and no webhook exists to
    // bring the successor back.
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
    const projection = createGenerationProjection(harness.handle, ownerCtx);
    expect((await projection.upsertQueued(target(pr, HEAD_1))).ok).toBe(true);
    const github = stubGitHub(HEAD_1);
    github.nextHeads = [HEAD_1];
    github.info = { ...github.info, headSha: HEAD_2 };
    const hangingGenerator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        return new Promise<never>((_, reject) => {
          req.signal?.addEventListener("abort", () => {
            // From the abort on, GitHub is unreachable.
            github.fetchPullRequestError = {
              code: "request-failed",
              status: 502,
              message: "GitHub API returned status 502",
            };
            reject(
              Object.assign(new Error("Request was aborted."), {
                name: "APIUserAbortError",
              }),
            );
          });
        });
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: hangingGenerator,
      github,
      headPollIntervalMs: 5,
    });

    await task({
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    expect((await projection.get(target(pr, HEAD_2)))?.status).toBe(
      GenerationStatuses.QUEUED,
    );
  });

  it("a url-box job cannot address an installation tenant's PR", async () => {
    // Installation world owns the row; a url-box payload naming its id must
    // drop (no artifacts, no projection transition).
    const { pr } = await trigger(HEAD_1);
    const payload = {
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    };
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    expect(generator.calls).toEqual([]);
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(brief).toBeUndefined();
  });
});

describe("generate task", () => {
  it("reads and stamps the primary issue through the job's GitHub source", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, body: "fixes #7" };
    github.issues.set("acme/widget#7", {
      title: "Stop the retry loop",
      state: "open",
      stateReason: null,
      labels: ["bug"],
      milestone: "v1",
      body: "The retry loop must stop after three attempts.",
      isPullRequest: false,
    });
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

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

  it("keeps a url-box read inside the PR's own repo", async () => {
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
    await createGenerationProjection(harness.handle, ownerCtx).upsertQueued(
      target(pr, HEAD_1),
    );
    const payload = {
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    };
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, body: "fixes acme/private-tracker#42" };
    github.issues.set("acme/private-tracker#42", {
      title: "Secret roadmap",
      state: "open",
      stateReason: null,
      labels: [],
      milestone: null,
      body: "Not for the public brief.",
      isPullRequest: false,
    });
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    const brief = await createArtifactStore(
      harness.handle,
      ownerCtx,
    ).briefs.get(pr.id, BASE, HEAD_1);
    const body = brief?.body ?? "{}";
    expect(JSON.parse(body)).toMatchObject({
      intentCheck: { primaryTicket: { status: "unread", reason: "not-found" } },
    });
    expect(body).not.toContain("Secret roadmap");
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
    await createGenerationProjection(harness.handle, ownerCtx).upsertQueued(
      target(pr, HEAD_1),
    );
    const payload = {
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    };
    const github = stubGitHub(HEAD_1);
    pointAtNotionPage(github);
    const notion = stubNotionFetch();
    try {
      await createGenerateTask({
        handle: harness.handle,
        publicBaseUrl: PUBLIC_URL,
        generator: stubGenerator(),
        github,
        trackerRoot: NOTION_ROOT,
      })(payload);
    } finally {
      notion.restore();
    }

    const brief = await createArtifactStore(
      harness.handle,
      ownerCtx,
    ).briefs.get(pr.id, BASE, HEAD_1);
    const body = brief?.body ?? "{}";
    expect(notion.calls).toEqual([]);
    // No Notion slot, so the page URL is never a ticket: no primary at all.
    expect(JSON.parse(body).intentCheck?.primaryTicket).toBeUndefined();
    expect(body).not.toContain("Secret roadmap");
  });

  it("reads installation-job Notion tickets through deployment credentials", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    pointAtNotionPage(github);
    const notion = stubNotionFetch();
    try {
      await createGenerateTask({
        handle: harness.handle,
        publicBaseUrl: PUBLIC_URL,
        generator: stubGenerator(),
        github,
        trackerRoot: NOTION_ROOT,
      })(payload);
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

  it("reports a missing issue as unread not-found on the stored brief", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, body: "fixes #404" };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      intentCheck: {
        primaryTicket: { status: "unread", reason: "not-found" },
      },
    });
  });

  it("drains ingest's payload into a stored brief, success state and audit", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(brief).toBeDefined();
    expect(brief?.headIndex).toBe(1);
    expect(brief?.provider).toBe("stub");
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
      target(pr, HEAD_1),
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
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, baseRef: "feature/a" };
    github.openPullRequests = [
      {
        number: 6,
        title: "Parent",
        headRef: "feature/a",
        baseRef: "main",
        headRepo: { owner: "acme", repo: "widget" },
        baseRepo: { owner: "acme", repo: "widget" },
      },
      {
        number: 7,
        title: "stub PR",
        headRef: "feature/stub",
        baseRef: "feature/a",
        headRepo: { owner: "acme", repo: "widget" },
        baseRepo: { owner: "acme", repo: "widget" },
      },
      {
        number: 8,
        title: "Child",
        headRef: "feature/c",
        baseRef: "feature/stub",
        headRepo: { owner: "acme", repo: "widget" },
        baseRepo: { owner: "acme", repo: "widget" },
      },
    ];
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
    });

    await task(payload);

    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      pr: {
        headRef: "feature/stub",
        baseRef: "feature/a",
        stack: {
          index: 2,
          members: [
            { number: 6, title: "Parent" },
            { number: 7, title: "stub PR" },
            { number: 8, title: "Child" },
          ],
        },
      },
    });
  });

  it("omits stack and still stamps refs when the open list fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.listOpenPullRequestsError = {
      code: GitHubApiErrorCodes.FORBIDDEN,
      status: 403,
      message:
        "failed to list open pull requests: GitHub API returned status 403",
    };
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
      log: logger,
    });

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
      lines().some(
        (line) => line["msg"] === "generate: open pull request list failed",
      ),
    ).toBe(true);
  });

  it("threads the instance-config effort into the stored brief's origin", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
      effort: "low",
    });

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
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

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

  it("posts the exact-span Entry deep link and stores its id", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    expect(github.comments.size).toBe(1);
    const [commentId, body] = [...github.comments.entries()][0] ?? [];
    expect(body).toContain(
      `${PUBLIC_URL}/repos/7/pulls/7?base=${BASE}&head=${HEAD_1}`,
    );

    const row = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(pr.id);
    expect(row?.entryCommentId).toBe(commentId);
  });

  it("replaces the generating Entry with a ready notification", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    const inner = stubGenerator();
    // Capture the live comment at the moment the model call runs.
    let bodyDuringGeneration: string | undefined;
    const generator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        if (req.label === "brief") {
          bodyDuringGeneration = [...github.comments.values()][0];
        }
        return inner.generate(req);
      },
      origin: (effort: Effort) => inner.origin(effort),
    };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    // While generating: the branded comment was already live, deep-linking the
    // wait screen for this exact span.
    expect(bodyDuringGeneration).toContain("generating");
    expect(bodyDuringGeneration).toContain(
      `${PUBLIC_URL}/repos/7/pulls/7?base=${BASE}&head=${HEAD_1}`,
    );

    // On ready: delete+repost, exactly one comment left, the ready body.
    expect(github.comments.size).toBe(1);
    const [readyId, readyBody] = [...github.comments.entries()][0] ?? [];
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
    const genId = github.commentCalls[0]?.slice("post:".length);
    expect(github.commentCalls).toEqual([
      `post:${genId}`,
      `delete:${genId}`,
      `post:${readyId}`,
    ]);
  });

  it("preserves an existing ready Entry on reruns without re-pinging", async () => {
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const afterFirstRun = github.commentCalls.length;
    const [readyId] = [...github.comments.entries()][0] ?? [];

    // Same head re-queued (review-submitted gap-filler / redelivery): the
    // brief is already stored and the ready comment is already live, the
    // rerun verifies the body via one fetch and posts NOTHING, delete+repost
    // here would re-ping the thread with no new information.
    const second = await trigger(HEAD_1);
    await task(second.payload);

    const rerunCalls = github.commentCalls.slice(afterFirstRun);
    expect(rerunCalls).toEqual([`fetch:${readyId}`]);
    expect(github.comments.get(readyId ?? -1n)).toContain("Read the brief");
  });

  it("a rerun with a stuck generating comment still flips it to ready", async () => {
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const [readyId] = [...github.comments.entries()][0] ?? [];
    // Simulate a prior attempt that died before the ready flip: the live
    // comment still says "generating" for this head.
    if (readyId === undefined) throw new Error("expected a live comment");
    github.comments.set(readyId, "Brief is generating for this push…");
    const afterFirstRun = github.commentCalls.length;

    const second = await trigger(HEAD_1);
    await task(second.payload);

    // Mismatch → the normal delete+repost self-heal runs.
    const rerunCalls = github.commentCalls.slice(afterFirstRun);
    const [newReadyId] = [...github.comments.entries()][0] ?? [];
    expect(rerunCalls).toEqual([
      `fetch:${readyId}`,
      `delete:${readyId}`,
      `post:${newReadyId}`,
    ]);
    expect([...github.comments.values()][0]).toContain("Read the brief");
  });

  it("a rerun whose tracked comment was manually deleted reposts it", async () => {
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const [readyId] = [...github.comments.entries()][0] ?? [];
    if (readyId === undefined) throw new Error("expected a live comment");
    // Someone deleted the Entry comment on GitHub; the stored id dangles.
    github.comments.delete(readyId);
    const afterFirstRun = github.commentCalls.length;

    const second = await trigger(HEAD_1);
    await task(second.payload);

    // Gone (fetch → ok undefined) → the self-heal reposts; the 404-tolerant
    // delete of the dangling id precedes the post.
    const rerunCalls = github.commentCalls.slice(afterFirstRun);
    const [newReadyId] = [...github.comments.entries()][0] ?? [];
    expect(rerunCalls).toEqual([
      `fetch:${readyId}`,
      `delete:${readyId}`,
      `post:${newReadyId}`,
    ]);
    expect([...github.comments.values()][0]).toContain("Read the brief");
  });

  it("a rerun whose comment-body fetch fails falls back to the repost cycle", async () => {
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    const first = await trigger(HEAD_1);
    await task(first.payload);
    const afterFirstRun = github.commentCalls.length;
    const [readyId] = [...github.comments.entries()][0] ?? [];
    github.fetchCommentError = {
      code: "request-failed",
      status: 500,
      message: "failed to fetch comment: GitHub API returned status 500",
    };

    const second = await trigger(HEAD_1);
    await task(second.payload);

    // Uncertainty never suppresses the flip: the delete+repost runs as before.
    const rerunCalls = github.commentCalls.slice(afterFirstRun);
    const [newReadyId] = [...github.comments.entries()][0] ?? [];
    expect(rerunCalls).toEqual([`delete:${readyId}`, `post:${newReadyId}`]);
    expect([...github.comments.values()][0]).toContain("Read the brief");
  });

  it("replaces the Entry on a second push and rotates its stored id", async () => {
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

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

    const row = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(second.pr.id);
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
      log: createLogger({
        env: {},
        destination: { write: (line: string) => void logs.push(line) },
      }),
    });

    await task(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
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
    const github = stubGitHub(HEAD_1);
    // Interleave: the PR row vanishes between the READY post and its
    // setEntryComment (purge race), the only way the id-store can fail. The
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
      log: createLogger({
        env: {},
        destination: { write: (line: string) => void logs.push(line) },
      }),
    });

    await task(payload);

    // The untracked comment was cleaned up, no orphan survives for a later
    // run to post past.
    expect(github.comments.size).toBe(0);
    const lastPost = github.commentCalls
      .filter((call) => call.startsWith("post:"))
      .at(-1);
    expect(lastPost).toBeDefined();
    const orphanId = lastPost?.slice("post:".length);
    // The cleanup delete follows the failed store, the run's final call.
    expect(github.commentCalls.at(-1)).toBe(`delete:${orphanId}`);
    expect(
      logs.some((line) => line.includes("entry comment id not stored")),
    ).toBe(true);
  });

  it("retains the stored id and skips reposting when Entry deletion fails", async () => {
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

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
    const row = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(second.pr.id);
    expect(row?.entryCommentId).toBe(firstId);
    // The job itself still succeeded.
    const projection = await createGenerationProjection(
      harness.handle,
      ctx,
    ).get(target(second.pr, HEAD_2));
    expect(projection?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("supersedes advanced heads without attempts changes or generation", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_2); // GitHub's head moved past the job's
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    const projection = createGenerationProjection(harness.handle, ctx);
    const before = await projection.get(target(pr, HEAD_1));

    await task(payload);

    const after = await projection.get(target(pr, HEAD_1));
    expect(after?.status).toBe(GenerationStatuses.SUPERSEDED);
    expect(after?.attempts).toBe(before?.attempts);
    expect(generator.calls).toEqual([]);
    // The App world schedules nothing here: the push's own webhook did.
    expect(await projection.get(target(pr, HEAD_2))).toBeUndefined();
  });

  it("marks superseded for a PR that went terminal after enqueue", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const setState = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.setState(pr.id, {
      state: PrStates.CLOSED,
      closedAt: new Date(),
      purgeAfter: null,
    });
    expect(setState.ok).toBe(true);
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_1),
    });

    await task(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUPERSEDED);
    expect(generator.calls).toEqual([]);
  });

  it("skips generation when the exact base/head brief already exists", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);
    await task(payload); // retry / redelivery

    expect(generator.calls).toEqual(["brief"]); // one spend, not two
  });

  it("writes marks + revision narrative against the previous briefed head", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    // Non-default effort so the narrative-site threading is pinned too.
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
      effort: "low",
    });
    await task(first.payload);

    github.info = { ...github.info, headSha: HEAD_2 };
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
      (narrativeWarnings as string[]).some((w) =>
        w.includes("revision narrative coverage"),
      ),
    ).toBe(true);
    expect(generator.calls).toEqual(["brief", "brief", "revision narrative"]);
  });

  it("pre-warms one delta core per distinct checkpoint SHA, with span marks", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    // Non-default effort so the delta-warm threading is pinned too.
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
      effort: "low",
    });
    await task(first.payload);

    // Two reviewers sharing one checkpoint SHA → ONE delta core.
    const repo = createTenantRepository(harness.handle, ctx);
    for (const reviewer of [100n, 200n]) {
      const written = await repo.checkpoints.upsertOnSubmit({
        pullRequestId: first.pr.id,
        reviewerId: makeReviewerId(reviewer),
        lastSubmittedSha: HEAD_1,
        submittedAt: new Date(),
      });
      expect(written.ok).toBe(true);
    }

    github.info = { ...github.info, headSha: HEAD_2 };
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const delta = await store.deltas.get(second.pr.id, HEAD_1, HEAD_2);
    expect(delta).toBeDefined();
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

  it("skips huge-span deltas for full-brief fallback", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });
    await task(first.payload);

    const written = await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: HEAD_1,
      submittedAt: new Date(),
    });
    expect(written.ok).toBe(true);

    github.info = { ...github.info, headSha: HEAD_2 };
    github.compareDiffs.set(`${HEAD_1}...${HEAD_2}`, HUGE_DIFF);
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    expect(
      await store.deltas.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeUndefined();
    // The span marks are still there, the honest highlights survive the skip.
    expect(
      await store.comparisonMarks.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeDefined();
    expect(generator.calls.filter((label) => label === "delta")).toHaveLength(
      0,
    );
  });

  it("drops a malformed payload without touching the database", async () => {
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_1),
    });

    await expect(task({ nonsense: true })).resolves.toBeUndefined();
    expect(generator.calls).toEqual([]);
    expect(await harness.raw("select * from brief")).toHaveLength(0);
  });

  it("records permanent GitHub failures without rethrowing for retry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.fetchPullRequestError = {
      code: "not-found",
      status: 404,
      message: "failed to fetch pull request: GitHub API returned status 404",
    };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
    });

    await expect(task(payload)).resolves.toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    // Stamped at the GitHub throw site, the code, not prose, is the record.
    expect(row?.errorCode).toBe("github-access");
    expect(row?.errorParams).toBeNull();
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
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
    });

    await expect(task(payload)).rejects.toThrow("502");

    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
  });

  it("aborts superseded streams without retry or attempts changes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    // Initial pre-flight check sees the job's head; every poll after sees the
    // superseding push.
    github.nextHeads = [HEAD_1];
    github.info = { ...github.info, headSha: HEAD_2 };

    // The brief call hangs until the threaded signal aborts, the SDK-abort
    // shape (APIUserAbortError) the worker must map to superseded.
    const calls: string[] = [];
    const hangingGenerator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        calls.push(req.label);
        return new Promise<never>((_, reject) => {
          req.signal?.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("Request was aborted."), {
                name: "APIUserAbortError",
              }),
            );
          });
        });
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };

    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: hangingGenerator,
      github,
      headPollIntervalMs: 5,
    });

    const projection = createGenerationProjection(harness.handle, ctx);
    const before = await projection.get(target(pr, HEAD_1));

    await expect(task(payload)).resolves.toBeUndefined(); // abort is NOT a job failure

    const after = await projection.get(target(pr, HEAD_1));
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

  it("supersedes between artifacts before spending on a delta", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const written = await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: "d".repeat(40),
      submittedAt: new Date(),
    });
    expect(written.ok).toBe(true);

    const github = stubGitHub(HEAD_1);
    // Pre-flight check passes; the pre-delta assertCurrent sees the new head.
    github.nextHeads = [HEAD_1];
    github.info = { ...github.info, headSha: HEAD_2 };
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
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
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUPERSEDED);
  });

  it("rethrows SDK connection errors as transient for graphile retry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_1),
    });

    // The SDK's connection error carries NO status and name "Error", only
    // an instanceof check can catch it.
    generator.failNextWith = new APIConnectionError({});
    await expect(task(payload)).rejects.toThrow("Connection error");

    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
  });

  it("requeues on shutdown without failed or superseded projection state", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const shutdown = new AbortController();
    const calls: string[] = [];
    const hangingGenerator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        calls.push(req.label);
        // Abort the "worker process" once the stream is in flight.
        queueMicrotask(() => shutdown.abort());
        return new Promise<never>((_, reject) => {
          req.signal?.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("Request was aborted."), {
                name: "APIUserAbortError",
              }),
            );
          });
        });
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: hangingGenerator,
      github: stubGitHub(HEAD_1),
    });

    // Rethrows (graphile requeues) but writes NO terminal/failed status.
    await expect(
      task(payload, { abortSignal: shutdown.signal }),
    ).rejects.toThrow("aborted");

    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(row?.errorCode).toBeNull();
  });

  it("recovers a missing narrative while reusing the stored brief", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });
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
      (l) => l === "revision narrative",
    ).length;
    await task(second.payload);
    expect(
      generator.calls.filter((l) => l === "revision narrative"),
    ).toHaveLength(narrativeCallsBefore);
  });

  it("reads the configured Notion ticket when retrying a stored narrative", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    pointAtNotionPage(github);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
      trackerRoot: NOTION_ROOT,
    });
    const firstNotion = stubNotionFetch();
    try {
      await task(first.payload);
    } finally {
      firstNotion.restore();
    }
    expect(firstNotion.calls).toHaveLength(2);

    github.info = { ...github.info, headSha: HEAD_2 };
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
    const fetchesBefore = github.repoFileCalls.length;
    try {
      await task(second.payload);
    } finally {
      retryNotion.restore();
    }
    expect(retryNotion.calls).toEqual([
      `/v1/pages/${NOTION_PAGE_ID}`,
      `/v1/blocks/${NOTION_PAGE_ID}/children`,
    ]);
    expect(github.repoFileCalls.length).toBeGreaterThan(fetchesBefore);
    expect(
      await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeDefined();

    // A further rerun spends nothing and so loads nothing: no config fetch.
    const settled = github.repoFileCalls.length;
    const idleNotion = stubNotionFetch();
    try {
      await task(second.payload);
    } finally {
      idleNotion.restore();
    }
    expect(idleNotion.calls).toEqual([]);
    expect(github.repoFileCalls.length).toBe(settled);
  });

  it("supersedes replaced projections after the newer head succeeds", async () => {
    const first = await trigger(HEAD_1); // queued row for head 1; job replaced below
    const second = await trigger(HEAD_2); // same job_key, payload now carries head 2
    expect(second.pr.id).toBe(first.pr.id);

    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_2),
    });
    await task(second.payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const stale = await projection.get(target(first.pr, HEAD_1));
    expect(stale?.status).toBe(GenerationStatuses.SUPERSEDED);
    const current = await projection.get(target(second.pr, HEAD_2));
    expect(current?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("rethrows transient failures but retains deterministic ones as failed", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    const overloaded = Object.assign(new Error("Overloaded"), { status: 529 });
    generator.failNextWith = overloaded;
    await expect(task(payload)).rejects.toThrow("Overloaded");
    let row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);

    generator.failNextWith = new Error("Model refused to produce the brief.");
    await expect(task(payload)).resolves.toBeUndefined();
    row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    // A plain-Error refusal has no stamp and no taxonomy, unknown{detail}.
    expect(row?.errorCode).toBe("unknown");
    expect(row?.errorParams?.detail).toContain("refused");
  });
});

// ---------------------------------------------------------------------------
// Repo-config phase.
// ---------------------------------------------------------------------------

function buildRepoFile(content: string, blobSha: string): RepoFileResult {
  return {
    kind: "file",
    content,
    blobSha,
    size: Buffer.byteLength(content, "utf8"),
  };
}

// ---------------------------------------------------------------------------
// Anchored generation.
// ---------------------------------------------------------------------------

/** Incremental diff touching only b.ts. */
const DIFF_TOUCHING_B = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
`;

/** A two-group brief generation output over a.ts + b.ts. */
function twoGroupBriefOutput(
  idA: string,
  titleA: string,
  idB: string,
  titleB: string,
): unknown {
  return {
    summary: "stub brief",
    intentCheck: {
      ticketUrls: [],
      ticketTitles: [],
      specificity: "none",
      scopeNote: "",
      items: [],
      alignment: { read: "", goal: "", response: "" },
    },
    changeGroups: [
      {
        id: idA,
        title: titleA,
        summary: `${titleA} summary`,
        dominantCategory: "bugfix",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
      {
        id: idB,
        title: titleB,
        summary: `${titleB} summary`,
        dominantCategory: "bugfix",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: `${idA}c`,
        changeGroupId: idA,
        file: "a.ts",
        concern: "implementation",
        role: "core",
        loc: { added: 4, deleted: 0 },
        addedRanges: [{ start: 5, end: 8 }],
        removedRanges: [],
        riskSurface: [],
      },
      {
        id: `${idB}c`,
        changeGroupId: idB,
        file: "b.ts",
        concern: "implementation",
        role: "core",
        loc: { added: 2, deleted: 0 },
        addedRanges: [{ start: 1, end: 2 }],
        removedRanges: [],
        riskSurface: [],
      },
    ],
    concernView: [{ concern: "implementation", added: 6, deleted: 0 }],
  };
}

describe("generate task, anchored generation", () => {
  const SPAN = `${HEAD_1}...${HEAD_2}`;

  /** Two-revision run: rev1 with gA/gB, then rev2 with the given output. */
  async function runTwoRevisions(options: {
    rev2Output?: unknown;
    fullRegeneration?: "always" | "on-model-swap" | "never";
    rev2Model?: string;
    rev2BaseSha?: string;
    compareFilesEntry?: {
      files: { filename: string; status: string }[];
      complete: boolean;
      status?: string;
    };
    /** Make the second revision's model call fail (the hop must survive). */
    rev2FailWith?: unknown;
    /** Fail the second revision's compare-files fetch. */
    rev2CompareFilesError?: GitHubApiError;
  }) {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] = twoGroupBriefOutput(
      "gA",
      "alpha",
      "gB",
      "beta",
    );
    const github = stubGitHub(HEAD_1);
    github.files = [
      { path: "a.ts", additions: 4, deletions: 0 },
      { path: "b.ts", additions: 2, deletions: 0 },
    ];
    github.compareDiffs.set(SPAN, DIFF_TOUCHING_B);
    github.compareFiles.set(
      SPAN,
      options.compareFilesEntry ?? {
        files: [{ filename: "b.ts", status: "modified" }],
        complete: true,
        status: "ahead",
      },
    );
    const taskDeps: Mutable<GenerateTaskDeps> = {
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    };

    if (options.fullRegeneration !== undefined) {
      taskDeps.fullRegeneration = options.fullRegeneration;
    }

    const task = createGenerateTask(taskDeps);
    await task(first.payload);

    const revisedInfo: Mutable<PullRequestInfo> = {
      ...github.info,
      headSha: HEAD_2,
    };

    if (options.rev2BaseSha !== undefined) {
      revisedInfo.baseSha = options.rev2BaseSha;
    }

    github.info = revisedInfo;
    generator.outputs["brief"] =
      options.rev2Output ??
      twoGroupBriefOutput("tmpA", "alpha rewritten", "tmpB", "beta v2");
    if (options.rev2Model !== undefined) {
      const model = options.rev2Model;
      generator.origin = (effort) => ({
        provider: "stub",
        model,
        effort,
      });
    }
    if (options.rev2CompareFilesError !== undefined) {
      github.fetchCompareFilesError = options.rev2CompareFilesError;
    }
    const second = await trigger(HEAD_2);
    if (options.rev2FailWith !== undefined) {
      generator.failNextWith = options.rev2FailWith;
      // oxlint-disable-next-line vitest/no-conditional-expect -- asserts the failure the caller staged.
      await expect(task(second.payload)).rejects.toThrow(APIConnectionError);
    } else {
      await task(second.payload);
    }
    return { pr: second.pr, generator, github };
  }

  it("carries frozen groups verbatim and stamps anchored origin", async () => {
    const { pr } = await runTwoRevisions({});
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("anchored");
    expect(row?.anchorReason).toBeNull();
    const body = JSON.parse(row?.body ?? "{}") as {
      anchor?: unknown;
      anchoring?: unknown;
      changeGroups?: { id: string; title: string }[];
      chunks?: { id: string; file: string; changeGroupId: string }[];
    };
    expect(body.anchor).toEqual({ state: "anchored" });
    expect(body.anchoring).toEqual({ carried: ["gA"], regenerated: ["gB"] });
    // The untouched group survives byte-identical; the touched one is the
    // model's fresh take under its DESCENDED (previous) id.
    expect(body.changeGroups).toContainEqual(
      expect.objectContaining({ id: "gA", title: "alpha" }),
    );
    expect(body.changeGroups).toContainEqual(
      expect.objectContaining({ id: "gB", title: "beta v2" }),
    );
    const carried = body.chunks?.find((c) => c.file === "a.ts");
    expect(carried?.changeGroupId).toBe("gA");
  });

  it("persists the hop and the carried chunk set alongside the brief", async () => {
    const { pr } = await runTwoRevisions({});
    const store = createArtifactStore(harness.handle, ctx);
    const hops = await store.hunkSpans.listForPullRequest(pr.id);
    expect(hops).toHaveLength(1);
    expect(hops[0]?.baselineSha).toBe(HEAD_1);
    expect(hops[0]?.headSha).toBe(HEAD_2);
    expect(JSON.parse(hops[0]?.spans ?? "[]")).toEqual([
      { file: "b.ts", hunks: [expect.objectContaining({ oldStart: 1 })] },
    ]);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    const body = JSON.parse(row?.body ?? "{}") as {
      chunks?: { id: string; file: string }[];
    };
    // Exactly the carried chunks: the a.ts chunk froze, b.ts was regenerated.
    const carriedIds = (body.chunks ?? [])
      .filter((c) => c.file === "a.ts")
      .map((c) => c.id);
    expect(JSON.parse(row?.carriedChunkIds ?? "null")).toEqual(carriedIds);
    expect(carriedIds).toHaveLength(1);
  });

  it("accumulates the chain's used group ids on the anchored path", async () => {
    const { pr } = await runTwoRevisions({});
    const store = createArtifactStore(harness.handle, ctx);
    const rev1 = await store.briefs.get(pr.id, BASE, HEAD_1);
    expect(JSON.parse(rev1?.usedGroupIds ?? "null")).toEqual(["gA", "gB"]);
    // Rev 2's groups descend back onto gA/gB, the union gains nothing.
    const rev2 = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(JSON.parse(rev2?.usedGroupIds ?? "null")).toEqual(["gA", "gB"]);
  });

  it("a fresh restart still accumulates the chain's used ids", async () => {
    // `always` writes the model's raw ids, the chain set must still union
    // them with history, or the next descent could resurrect gA/gB.
    const { pr } = await runTwoRevisions({ fullRegeneration: "always" });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(JSON.parse(row?.usedGroupIds ?? "null")).toEqual([
      "gA",
      "gB",
      "tmpA",
      "tmpB",
    ]);
  });

  it("a same-head base retarget keeps the chain's used ids", async () => {
    // One briefed head, then the base retargets under it: `prevBrief` (a
    // DIFFERENT head) is undefined, so the chain must read off the newest
    // row itself. `gZ` lives only in the stored column, in no body, the
    // assertion fails if the read falls back to the body or resets.
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] = twoGroupBriefOutput(
      "gA",
      "alpha",
      "gB",
      "beta",
    );
    const github = stubGitHub(HEAD_1);
    github.files = [
      { path: "a.ts", additions: 4, deletions: 0 },
      { path: "b.ts", additions: 2, deletions: 0 },
    ];
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });
    await task(first.payload);
    await harness.raw(
      `update brief set used_group_ids = '["gA","gB","gZ"]' where head_sha = '${HEAD_1}'`,
    );

    const BASE_2 = "d".repeat(40);
    github.info = { ...github.info, baseSha: BASE_2 };
    generator.outputs["brief"] = twoGroupBriefOutput(
      "tmpA",
      "alpha again",
      "tmpB",
      "beta again",
    );
    const again = await trigger(HEAD_1);
    await task(again.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(again.pr.id, BASE_2, HEAD_1);
    expect(JSON.parse(row?.usedGroupIds ?? "null")).toEqual([
      "gA",
      "gB",
      "gZ",
      "tmpA",
      "tmpB",
    ]);
  });

  it("heals a NULL chain column from the previous body", async () => {
    // Rev 1 predates the column (NULL): the fresh rev-2 union must still
    // hold rev 1's ids, seeded from the recovered body.
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] = twoGroupBriefOutput(
      "gA",
      "alpha",
      "gB",
      "beta",
    );
    const github = stubGitHub(HEAD_1);
    github.files = [
      { path: "a.ts", additions: 4, deletions: 0 },
      { path: "b.ts", additions: 2, deletions: 0 },
    ];
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
      fullRegeneration: "always",
    });
    await task(first.payload);
    await harness.raw(
      `update brief set used_group_ids = null where head_sha = '${HEAD_1}'`,
    );

    github.info = { ...github.info, headSha: HEAD_2 };
    generator.outputs["brief"] = twoGroupBriefOutput(
      "tmpA",
      "alpha v2",
      "tmpB",
      "beta v2",
    );
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(second.pr.id, BASE, HEAD_2);
    expect(JSON.parse(row?.usedGroupIds ?? "null")).toEqual([
      "gA",
      "gB",
      "tmpA",
      "tmpB",
    ]);
  });

  it("leaves the hop behind when the model call fails", async () => {
    const { pr } = await runTwoRevisions({
      rev2FailWith: new APIConnectionError({}),
    });
    const store = createArtifactStore(harness.handle, ctx);
    // No brief for the failed head, but the hop is durable: the next session
    // can still place its anchors across the push.
    expect(await store.briefs.get(pr.id, BASE, HEAD_2)).toBeUndefined();
    expect(await store.hunkSpans.listForPullRequest(pr.id)).toHaveLength(1);
  });

  it("writes an empty carried set when nothing anchors", async () => {
    const { pr } = await runTwoRevisions({ fullRegeneration: "always" });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("none");
    expect(row?.carriedChunkIds).toBe("[]");
    expect(await store.hunkSpans.listForPullRequest(pr.id)).toHaveLength(0);
  });

  it("always mode keeps fresh ids and stamps anchoring none", async () => {
    const { pr } = await runTwoRevisions({ fullRegeneration: "always" });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("none");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchor?: unknown;
      anchoring?: unknown;
      changeGroups?: { id: string }[];
    };
    expect(body.anchor).toEqual({ state: "none" });
    expect(body.anchoring).toBeUndefined();
    expect(body.changeGroups?.map((g) => g.id)).toEqual(["tmpA", "tmpB"]);
  });

  it("on-model-swap restarts fresh and stamps the changed-model reason", async () => {
    const { pr } = await runTwoRevisions({
      fullRegeneration: "on-model-swap",
      rev2Model: "stub-model-2",
    });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("fresh-restart");
    expect(row?.anchorReason).toBe("model-swap");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchor?: unknown;
      changeGroups?: { id: string }[];
    };
    expect(body.anchor).toEqual({
      state: "fresh-restart",
      reason: "model-swap",
    });
    expect(body.changeGroups?.map((g) => g.id)).toEqual(["tmpA", "tmpB"]);
  });

  it("`on-model-swap` with an unchanged model anchors normally", async () => {
    const { pr } = await runTwoRevisions({ fullRegeneration: "on-model-swap" });
    const row = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_2,
    );
    expect(row?.anchorState).toBe("anchored");
  });

  it("reviews everything after a base move while retaining id descent", async () => {
    const BASE_2 = "d".repeat(40);
    const { pr } = await runTwoRevisions({ rev2BaseSha: BASE_2 });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE_2, HEAD_2);
    expect(row?.anchorState).toBe("anchored");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchoring?: { carried: string[]; regenerated: string[] };
      changeGroups?: { id: string; title: string }[];
    };
    expect(body.anchoring?.carried).toEqual([]);
    // Nothing carried, but descent still maps the fresh groups onto the
    // previous ids, group identity survives the rebase.
    expect(body.changeGroups?.map((g) => g.id).toSorted()).toEqual([
      "gA",
      "gB",
    ]);
    expect(body.changeGroups?.find((g) => g.id === "gA")?.title).toBe(
      "alpha rewritten",
    );
  });

  it("threads the anchor view and anchored prompt into the model call", async () => {
    const { generator } = await runTwoRevisions({});
    const briefRequests = generator.requests.filter((r) => r.label === "brief");
    expect(briefRequests).toHaveLength(2);
    expect(briefRequests[0]?.system).not.toContain("Anchored regeneration");
    expect(briefRequests[0]?.user).not.toContain("<anchor_brief");
    expect(briefRequests[1]?.system).toContain("Anchored regeneration");
    expect(briefRequests[1]?.user).toContain("<anchor_brief");
    // The frozen index names the untouched group; the summary rides verbatim.
    expect(briefRequests[1]?.user).toContain("gA");
  });

  it("degrades to a full re-look when compare files cannot be fetched", async () => {
    const { pr, generator } = await runTwoRevisions({
      rev2CompareFilesError: {
        code: GitHubApiErrorCodes.REQUEST_FAILED,
        status: 502,
        message: "compare files unavailable",
      },
    });
    const row = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_2,
    );
    // The job still runs and still anchors: the previous brief and the chain's
    // ids survive. Nothing carries, because the compare-files list is what
    // confirms a group untouched, and it never arrived.
    expect(row?.anchorState).toBe("anchored");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchoring?: { carried: string[] };
    };
    expect(body.anchoring?.carried).toEqual([]);
    const briefRequests = generator.requests.filter((r) => r.label === "brief");
    expect(briefRequests[1]?.system).toContain("Anchored regeneration");
  });

  it("carries nothing for diverged same-base spans but remains anchored", async () => {
    const { pr } = await runTwoRevisions({
      compareFilesEntry: {
        files: [{ filename: "b.ts", status: "modified" }],
        complete: true,
        status: "diverged",
      },
    });
    const row = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_2,
    );
    expect(row?.anchorState).toBe("anchored");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchoring?: { carried: string[] };
    };
    expect(body.anchoring?.carried).toEqual([]);
  });

  it("a coverage failure is a permanent pipeline error, not salvage", async () => {
    // b.ts lands in TWO groups, which no reader can resolve. A file in NO
    // group is the unattributed remainder and warns instead; see below.
    const rev2Output = {
      summary: "stub brief",
      intentCheck: {
        ticketUrls: [],
        ticketTitles: [],
        specificity: "none",
        scopeNote: "",
        items: [],
        alignment: { read: "", goal: "", response: "" },
      },
      changeGroups: [
        {
          id: "tmpA",
          title: "only alpha",
          summary: "s",
          dominantCategory: "bugfix",
          secondaryCategories: [],
          uncertain: false,
          uncertainBetween: [],
        },
        {
          id: "tmpB",
          title: "also beta",
          summary: "s",
          dominantCategory: "bugfix",
          secondaryCategories: [],
          uncertain: false,
          uncertainBetween: [],
        },
      ],
      chunks: [
        {
          id: "c9",
          changeGroupId: "tmpA",
          file: "b.ts",
          concern: "implementation",
          role: "core",
          loc: { added: 2, deleted: 0 },
          addedRanges: [{ start: 1, end: 2 }],
          removedRanges: [],
          riskSurface: [],
        },
        {
          id: "c10",
          changeGroupId: "tmpB",
          file: "b.ts",
          concern: "implementation",
          role: "core",
          loc: { added: 2, deleted: 0 },
          addedRanges: [{ start: 3, end: 4 }],
          removedRanges: [],
          riskSurface: [],
        },
      ],
      concernView: [{ concern: "implementation", added: 4, deleted: 0 }],
    };
    const { pr } = await runTwoRevisions({ rev2Output });
    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_2),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe("unknown");
    expect(row?.errorParams?.detail).toContain("coverage");
    // No brief row was written for the failed span.
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_2,
    );
    expect(brief).toBeUndefined();
  });
});

describe("generate task, repo-config phase", () => {
  const POLICY_YAML = `version: 1
attributes:
  touches-billing:
    criteria: modifies invoicing code
    implication: needs finance review
deEmphasize:
  - attribute: widens-error-handling
`;
  const SETTINGS_YAML = "version: 1\nentryCommentOnDrafts: true\n";
  const INSTRUCTIONS_MD = "Call the invoicing engine 'the biller'.";

  /** A brief output whose one chunk fires the repo-defined attribute. */
  const FIRING_BRIEF = {
    summary: "stub brief",
    intentCheck: {
      ticketUrls: [],
      ticketTitles: [],
      specificity: "none",
      scopeNote: "",
      items: [],
      alignment: { read: "", goal: "", response: "" },
    },
    changeGroups: [
      {
        id: "g1",
        title: "billing",
        summary: "s",
        dominantCategory: "new-feature",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: "c1",
        changeGroupId: "g1",
        file: "a.ts",
        concern: "implementation",
        role: "core",
        loc: { added: 1, deleted: 0 },
        addedRanges: [{ start: 2, end: 2 }],
        removedRanges: [],
        riskSurface: ["touches-billing"],
      },
    ],
    concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
  };

  async function storedRepoConfig(pr: PullRequestRow, headSha: string) {
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      headSha,
    );
    expect(brief?.repoConfig).toBeTruthy();
    const parsed: unknown = JSON.parse(brief?.repoConfig ?? "null");
    return repoConfigArtifactSchema.parse(parsed);
  }

  it("injects fixed-path config and snapshots outcomes and fired attributes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] = FIRING_BRIEF;
    const github = stubGitHub(HEAD_1);
    github.repoFiles.set(
      RepoConfigPaths.INSTRUCTIONS,
      buildRepoFile(INSTRUCTIONS_MD, "sha-i"),
    );
    github.repoFiles.set(
      RepoConfigPaths.SETTINGS,
      buildRepoFile(SETTINGS_YAML, "sha-s"),
    );
    github.repoFiles.set(
      RepoConfigPaths.POLICY,
      buildRepoFile(POLICY_YAML, "sha-p"),
    );
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    expect(github.repoFileCalls.toSorted()).toEqual(
      [
        RepoConfigPaths.INSTRUCTIONS,
        RepoConfigPaths.SETTINGS,
        RepoConfigPaths.POLICY,
      ].toSorted(),
    );
    // The brief request carried the injected context, fenced data + contract,
    // and its schema ACCEPTED the custom token (the stub parses the canned
    // output through the request's own schema, so this line having passed IS
    // the enum-extension proof).
    const request = generator.requests.find((r) => r.label === "brief");
    expect(request?.user).toContain(
      '<repo_instructions path=".mergebrief/instructions.md" sha="sha-i">',
    );
    expect(request?.user).toContain("the biller");
    expect(request?.user).toContain(
      "- `touches-billing`: modifies invoicing code",
    );
    expect(request?.system).toContain(
      "## Repo instructions (semi-trusted, bounded)",
    );

    const artifact = await storedRepoConfig(pr, HEAD_1);
    expect(artifact.files.map((f) => [f.path, f.outcome, f.blobSha])).toEqual([
      [RepoConfigPaths.INSTRUCTIONS, "applied", "sha-i"],
      [RepoConfigPaths.SETTINGS, "applied", "sha-s"],
      [RepoConfigPaths.POLICY, "applied", "sha-p"],
    ]);
    expect(artifact.collisions).toEqual([]);
    expect(artifact.policy?.firedCustomAttributes).toEqual([
      {
        name: "touches-billing",
        criteria: "modifies invoicing code",
        implication: "needs finance review",
      },
    ]);
    expect(artifact.policy?.deEmphasize).toEqual([
      { attribute: "widens-error-handling" },
    ]);
  });

  it("records absent config and null policy without changing prompts", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    const artifact = await storedRepoConfig(pr, HEAD_1);
    expect(
      artifact.files.every((f) => f.outcome === "absent" && f.blobSha === null),
    ).toBe(true);
    expect(artifact.policy).toBeNull();
    const request = generator.requests.find((r) => r.label === "brief");
    expect(request?.user).not.toContain("repo_instructions");
    expect(request?.system).not.toContain("Repo instructions");
  });

  it("rejects invalid settings wholly while applying valid sibling files", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.repoFiles.set(
      RepoConfigPaths.SETTINGS,
      buildRepoFile("version: 2\n", "sha-bad"),
    );
    github.repoFiles.set(
      RepoConfigPaths.INSTRUCTIONS,
      buildRepoFile(INSTRUCTIONS_MD, "sha-i"),
    );
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    const artifact = await storedRepoConfig(pr, HEAD_1);
    const byPath = new Map(artifact.files.map((f) => [f.path, f]));
    expect(byPath.get(RepoConfigPaths.SETTINGS)?.outcome).toBe("invalid");
    expect(byPath.get(RepoConfigPaths.SETTINGS)?.blobSha).toBe("sha-bad");
    expect(byPath.get(RepoConfigPaths.INSTRUCTIONS)?.outcome).toBe("applied");
    // Job still succeeds, repo-config problems never fail a generation.
    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("generates despite per-file fetch failures and records their outcomes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.repoFileErrors.set(RepoConfigPaths.POLICY, {
      code: "request-failed",
      status: 502,
      message: "failed to fetch repo file: GitHub API returned status 502",
    });
    github.repoFiles.set(
      RepoConfigPaths.SETTINGS,
      buildRepoFile(SETTINGS_YAML, "sha-s"),
    );
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    const artifact = await storedRepoConfig(pr, HEAD_1);
    const byPath = new Map(artifact.files.map((f) => [f.path, f]));
    expect(byPath.get(RepoConfigPaths.POLICY)?.outcome).toBe("fetch-failed");
    expect(byPath.get(RepoConfigPaths.SETTINGS)?.outcome).toBe("applied");
    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("records pre-decode oversize refusals as over-budget with fetch facts", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.repoFiles.set(RepoConfigPaths.INSTRUCTIONS, {
      kind: "too-large",
      blobSha: "sha-big",
      size: 20_000,
    });
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    const artifact = await storedRepoConfig(pr, HEAD_1);
    const instructions = artifact.files.find(
      (f) => f.path === RepoConfigPaths.INSTRUCTIONS,
    );
    expect(instructions?.outcome).toBe("over-budget");
    expect(instructions?.blobSha).toBe("sha-big");
    expect(instructions?.bytesUsed).toBe(20_000);
    expect(instructions?.bytesBudget).toBe(16 * 1024);
  });

  it("reuses stored snapshots without refetching config on skip drains", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] = FIRING_BRIEF;
    const github = stubGitHub(HEAD_1);
    github.repoFiles.set(
      RepoConfigPaths.POLICY,
      buildRepoFile(POLICY_YAML, "sha-p"),
    );
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });
    await task(payload);
    const fetchesAfterFirst = github.repoFileCalls.length;
    const before = await storedRepoConfig(pr, HEAD_1);

    await task(payload); // second drain: brief already stored → skip branch

    expect(github.repoFileCalls.length).toBe(fetchesAfterFirst);
    expect(await storedRepoConfig(pr, HEAD_1)).toEqual(before);
  });
});

describe("categorizer and repo-config vocabulary lockstep", () => {
  it("shares reserved names, name patterns and instruction budgets", () => {
    expect([...CAT_PARKED]).toEqual([...PARKED_ATTRIBUTE_CANDIDATES]);
    expect([...CAT_RESERVED]).toEqual([...RESERVED_ATTRIBUTE_WORDS]);
    expect(CUSTOM_ATTRIBUTE_NAME_PATTERN.source).toBe(
      ATTRIBUTE_NAME_PATTERN.source,
    );
    expect(INSTRUCTIONS_INJECTION_BUDGET_BYTES).toBe(INSTRUCTIONS_BUDGET_BYTES);
  });
});

describe("generate task, repo-config origin on the generation record", () => {
  it("records config before generation so outcomes survive failed runs", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    // Deterministic (permanent) generation failure AFTER acquisition.
    generator.failNextWith = new Error("model refused");
    const github = stubGitHub(HEAD_1);
    github.repoFiles.set(RepoConfigPaths.SETTINGS, {
      kind: "file",
      content: "version: 2\n",
      blobSha: "sha-bad",
      size: 11,
    });
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    const origin = repoConfigOriginSchema.parse(
      JSON.parse(row?.repoConfig ?? "null"),
    );
    const byPath = new Map(origin.files.map((f) => [f.path, f]));
    expect(byPath.get(RepoConfigPaths.SETTINGS)?.outcome).toBe("invalid");
    expect(byPath.get(RepoConfigPaths.INSTRUCTIONS)?.outcome).toBe("absent");
    // No brief artifact exists, the generation record is the only witness.
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        BASE,
        HEAD_1,
      ),
    ).toBeUndefined();
  });

  it("records config outcomes on both rows after successful generation", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    const origin = repoConfigOriginSchema.parse(
      JSON.parse(row?.repoConfig ?? "null"),
    );
    expect(origin.files.every((f) => f.outcome === "absent")).toBe(true);
    expect(origin.collisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Entry-comment draft gate.
// ---------------------------------------------------------------------------

describe("generate task, entry-comment draft gate", () => {
  const OPT_IN_SETTINGS = "version: 1\nentryCommentOnDrafts: true\n";

  it("generates drafts without settings while suppressing both Entries", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, draft: true };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    expect(github.commentCalls).toEqual([]);
    expect(github.comments.size).toBe(0);
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(brief).toBeDefined();
    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("posts draft Entries only when repo settings opt in", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, draft: true };
    github.repoFiles.set(RepoConfigPaths.SETTINGS, {
      kind: "file",
      content: OPT_IN_SETTINGS,
      blobSha: "sha-s",
      size: OPT_IN_SETTINGS.length,
    });
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    // generating + ready = two posts (one delete in between).
    expect(
      github.commentCalls.filter((c) => c.startsWith("post:")),
    ).toHaveLength(2);
    expect(github.comments.size).toBe(1);
  });

  it("posts the previously suppressed draft Entry on a ready skip drain", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, draft: true };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });
    await task(payload); // draft drain: brief stored, no comments
    expect(github.comments.size).toBe(0);

    // ready_for_review: same head, draft flips false, brief already stored.
    github.info = { ...github.info, draft: false };
    const second = await trigger(HEAD_1);
    await task(second.payload);

    expect(github.comments.size).toBe(1);
    const [body] = [...github.comments.values()];
    expect(body).toBeTruthy();
  });

  it("lazily reads draft skip settings and posts only with opt-in", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, draft: true };
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });
    await task(payload); // fresh draft drain, silent
    const fetchesAfterFirst = github.repoFileCalls.length;

    // Re-drain (skip path) while STILL a draft: still silent, and settings
    // were (re)acquired for the gate.
    const again = await trigger(HEAD_1);
    await task(again.payload);
    expect(github.comments.size).toBe(0);
    expect(github.repoFileCalls.length).toBeGreaterThan(fetchesAfterFirst);

    // Opt in and re-drain (skip path): the ready-flip refresh now posts.
    github.repoFiles.set(RepoConfigPaths.SETTINGS, {
      kind: "file",
      content: OPT_IN_SETTINGS,
      blobSha: "sha-s",
      size: OPT_IN_SETTINGS.length,
    });
    const third = await trigger(HEAD_1);
    await task(third.payload);
    expect(github.comments.size).toBe(1);
  });

  it("keeps draft Entry posting closed when settings fetching fails", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, draft: true };
    github.repoFileErrors.set(RepoConfigPaths.SETTINGS, {
      code: "request-failed",
      status: 502,
      message: "failed to fetch repo file: GitHub API returned status 502",
    });
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });

    await task(payload);

    expect(github.comments.size).toBe(0);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(
        (await createTenantRepository(
          harness.handle,
          ctx,
        ).pullRequests.getByNumber(makeRepoId(7n), 7))!,
        HEAD_1,
      ),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("deletes lingering Entries when converting to draft", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });
    await task(payload); // non-draft: entry comment live
    expect(github.comments.size).toBe(1);

    // Convert to draft, push a new head: fresh generation, gate closed,
    // the stale comment (deep-linking the OLD head) must be deleted.
    github.info = { ...github.info, draft: true, headSha: HEAD_2 };
    const second = await trigger(HEAD_2);
    await task(second.payload);

    expect(github.comments.size).toBe(0);
    const brief2 = await createArtifactStore(harness.handle, ctx).briefs.get(
      second.pr.id,
      BASE,
      HEAD_2,
    );
    expect(brief2).toBeDefined();
  });

  it("preserves live Entries when settings fetching fails", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, draft: true };
    github.repoFiles.set(RepoConfigPaths.SETTINGS, {
      kind: "file",
      content: OPT_IN_SETTINGS,
      blobSha: "sha-s",
      size: OPT_IN_SETTINGS.length,
    });
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });
    await task(payload); // opt-in draft: comment live
    expect(github.comments.size).toBe(1);

    // Next drain hits a 502 on settings: posting gate closes (nothing new
    // posts) but the healthy opt-in comment SURVIVES.
    github.repoFileErrors.set(RepoConfigPaths.SETTINGS, {
      code: "request-failed",
      status: 502,
      message: "failed to fetch repo file: GitHub API returned status 502",
    });
    const postsBefore = github.commentCalls.filter((c) =>
      c.startsWith("post:"),
    ).length;
    const again = await trigger(HEAD_1);
    await task(again.payload);

    expect(github.comments.size).toBe(1);
    expect(
      github.commentCalls.filter((c) => c.startsWith("post:")).length,
    ).toBe(postsBefore);
  });

  it("posts non-draft Entries without extra config reads on skips", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_1);
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
    });
    await task(payload);
    const fetchesAfterFirst = github.repoFileCalls.length;
    expect(github.comments.size).toBe(1);

    const again = await trigger(HEAD_1);
    await task(again.payload); // skip drain, non-draft: no config fetch
    expect(github.repoFileCalls.length).toBe(fetchesAfterFirst);
  });
});

function captureLogger() {
  const written: string[] = [];
  const logger = createLogger({
    env: {},
    destination: { write: (line: string) => void written.push(line) },
  });
  const lines = (): Array<Record<string, unknown>> =>
    written.map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error(`expected NDJSON object: ${line}`);
      }
      return { ...parsed };
    });
  return { logger, lines };
}

describe("generate task, observability", () => {
  it("logs transient job.fail with attempts and job bindings", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.fetchPullRequestError = {
      code: "request-failed",
      status: 502,
      message: "failed to fetch pull request: GitHub API returned status 502",
    };
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
      log: logger,
    });

    await expect(
      task(payload, { job: { attempts: 1, max_attempts: 25 } }),
    ).rejects.toThrow("502");

    const fail = lines().find((l) => l["evt"] === "job.fail");
    expect(fail?.["level"]).toBe("error");
    expect(fail?.["permanent"]).toBe(false);
    expect(fail?.["attempt"]).toBe(1);
    expect(fail?.["maxAttempts"]).toBe(25);
    expect(fail?.["prId"]).toBe(String(pr.id));
    expect(fail?.["headSha"]).toBe(HEAD_1);
    expect(lines().some((l) => l["evt"] === "job.retries.exhausted")).toBe(
      false,
    );
  });

  it("logs generation.complete with the model call duration", async () => {
    const { payload } = await trigger(HEAD_1);
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github: stubGitHub(HEAD_1),
      log: logger,
    });

    await task(payload);

    const done = lines().find((l) => l["evt"] === "generation.complete");
    expect(done?.["level"]).toBe("info");
    expect(done?.["kind"]).toBe("brief");
    expect(done?.["outcome"]).toBe("succeeded");
    expect(typeof done?.["durationMs"]).toBe("number");
  });

  it("logs generation.complete when the model call throws", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.generate = () => {
      throw new Error("provider exploded");
    };
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_1),
      log: logger,
    });

    // A permanent provider failure is recorded, not rethrown.
    await task(payload);

    const done = lines().find((l) => l["evt"] === "generation.complete");
    expect(done?.["outcome"]).toBe("failed");
    expect(typeof done?.["durationMs"]).toBe("number");
  });

  it("logs permanent job.fail without rethrowing", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.fetchPullRequestError = {
      code: "not-found",
      status: 404,
      message: "failed to fetch pull request: GitHub API returned status 404",
    };
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
      log: logger,
    });

    await expect(
      task(payload, { job: { attempts: 1, max_attempts: 25 } }),
    ).resolves.toBeUndefined();

    const fail = lines().find((l) => l["evt"] === "job.fail");
    expect(fail?.["permanent"]).toBe(true);
  });

  it("mints job.retries.exhausted on the final attempt", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.fetchPullRequestError = {
      code: "request-failed",
      status: 502,
      message: "failed to fetch pull request: GitHub API returned status 502",
    };
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
      log: logger,
    });

    await expect(
      task(payload, { job: { attempts: 25, max_attempts: 25 } }),
    ).rejects.toThrow("502");

    const exhausted = lines().find((l) => l["evt"] === "job.retries.exhausted");
    expect(exhausted?.["level"]).toBe("error");
    expect(exhausted?.["attempt"]).toBe(25);
    expect(exhausted?.["prId"]).toBe(String(pr.id));
    expect(exhausted?.["headSha"]).toBe(HEAD_1);
  });

  it("a provider-call failure emits provider.error with provider and status", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    const throwing: Generator = {
      async generate(): Promise<never> {
        throw Object.assign(new Error("rate limited"), { status: 429 });
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: throwing,
      github,
      log: logger,
    });

    await expect(
      task(payload, { job: { attempts: 1, max_attempts: 25 } }),
    ).rejects.toThrow("rate limited");

    const provider = lines().find((l) => l["evt"] === "provider.error");
    expect(provider?.["level"]).toBe("error");
    expect(provider?.["provider"]).toBe("stub");
    expect(provider?.["status"]).toBe(429);
    expect(provider?.["headSha"]).toBe(HEAD_1);
    expect(lines().some((l) => l["evt"] === "job.fail")).toBe(true);
  });

  it("a GeneratorError emits provider.error with its kind", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    const throwing: Generator = {
      async generate(): Promise<never> {
        throw new GeneratorError(
          GeneratorErrorKinds.AUTH,
          "provider rejected the key",
        );
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: throwing,
      github,
      log: logger,
    });

    await expect(task(payload)).resolves.toBeUndefined();

    const provider = lines().find((l) => l["evt"] === "provider.error");
    expect(provider?.["provider"]).toBe("stub");
    expect(provider?.["kind"]).toBe("auth");
    const fail = lines().find((l) => l["evt"] === "job.fail");
    expect(fail?.["permanent"]).toBe(true);
  });

  it("success-path lines ride the {prId, headSha} bindings", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github: stubGitHub(HEAD_1),
      log: logger,
    });

    await task(payload);

    const succeeded = lines().find(
      (l) => typeof l["msg"] === "string" && l["msg"].includes("succeeded"),
    );
    expect(succeeded?.["prId"]).toBe(String(pr.id));
    expect(succeeded?.["headSha"]).toBe(HEAD_1);
  });
});

describe("generate task, daily generation cap", () => {
  const UNCAPPED = { dailyGenerationCap: null, perRepo: {} };

  /** Burn one STARTED run for acme/widget so the cap has something to count. */
  async function burnOneRun(): Promise<void> {
    const { payload } = await trigger(HEAD_1);
    await createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github: stubGitHub(HEAD_1),
      spend: UNCAPPED,
    })(payload);
  }

  it("proceeds while the repo is under its cap", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_1),
      spend: { dailyGenerationCap: 5, perRepo: {} },
    });

    await task(payload);

    expect(generator.calls).toEqual(["brief"]);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("excludes the deciding run from the cap so a first run can proceed", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    await createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_1),
      spend: { dailyGenerationCap: 1, perRepo: {} },
    })(payload);

    expect(generator.calls).toEqual(["brief"]);
    expect(
      (
        await createGenerationProjection(harness.handle, ctx).get(
          target(pr, HEAD_1),
        )
      )?.status,
    ).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("caps before provider calls and records capped state and cap events", async () => {
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_2);
    const { logger, lines } = captureLogger();
    const task = createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
      spend: { dailyGenerationCap: 1, perRepo: {} },
      log: logger,
    });

    await task(payload);

    // No provider call, and no brief for the capped head.
    expect(generator.calls).toEqual([]);
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        BASE,
        HEAD_2,
      ),
    ).toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_2),
    );
    expect(row?.status).toBe(GenerationStatuses.CAPPED);
    // Not a failure: no error code, no attempt consumed.
    expect(row?.errorCode).toBeNull();
    expect(row?.attempts).toBe(0);

    const trip = lines().find((line) => line["evt"] === "spend.cap.trip");
    expect(trip).toBeDefined();
    expect(trip?.["level"]).toBe("warn");
    expect(trip?.["repo"]).toBe("acme/widget");
    expect(trip?.["prId"]).toBe(String(pr.id));
    expect(trip?.["cap"]).toBe(1);
    expect(typeof trip?.["dayUtc"]).toBe("string");
    // Nothing interpolated into msg.
    expect(String(trip?.["msg"])).not.toContain("acme/widget");
  });

  it("at the cap: UPDATES an existing Entry comment and never creates one", async () => {
    // The first run posts the Entry comment; the second is capped.
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const github = stubGitHub(HEAD_2);
    const prRow = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(pr.id);
    // Re-seed the live comment the first run posted into this run's stub.
    const liveId = prRow?.entryCommentId;
    expect(liveId).not.toBeNull();
    if (liveId === null || liveId === undefined)
      throw new Error("no entry comment to update");
    github.comments.set(liveId, "the ready body from the previous run");

    await createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
      spend: { dailyGenerationCap: 1, perRepo: {} },
    })(payload);

    // Replace-never-duplicate: still exactly ONE comment, now the capped body.
    expect(github.comments.size).toBe(1);
    const body = [...github.comments.values()][0] ?? "";
    expect(body).toContain("Daily generation cap reached");
    expect(body).toContain(`${PUBLIC_URL}/repos/7/pulls/7`);
    expect(body).toContain(HEAD_2.slice(0, 7));
  });

  it("at the cap with NO Entry comment: creates none", async () => {
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const github = stubGitHub(HEAD_2);
    // Clear the tracked comment: this PR has none on the thread.
    await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.setEntryComment(pr.id, null);

    await createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator: stubGenerator(),
      github,
      spend: { dailyGenerationCap: 1, perRepo: {} },
    })(payload);

    expect(github.comments.size).toBe(0);
    expect(github.commentCalls).toEqual([]);
  });

  it("counts ATTEMPTS: one row re-queued to attempts=3 fills a cap of 3", async () => {
    // graphile/webhook re-queues make ONE row several paid runs; the gate
    // must see the spend, not the row count.
    await burnOneRun();
    await harness.raw(
      "update generation set attempts = 3 where head_sha = '" + HEAD_1 + "'",
    );
    const { pr, payload } = await trigger(HEAD_2);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_2);

    await createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github,
      spend: { dailyGenerationCap: 3, perRepo: {} },
    })(payload);

    expect(generator.calls).toEqual([]);
    expect(
      (
        await createGenerationProjection(harness.handle, ctx).get(
          target(pr, HEAD_2),
        )
      )?.status,
    ).toBe(GenerationStatuses.CAPPED);
  });

  it("preserves failed rows when retries reach the cap", async () => {
    await burnOneRun();
    // The PR's own run failed; graphile will retry it. Meanwhile the repo
    // sits at its cap, so the retry lands in the gate.
    const { pr, payload } = await trigger(HEAD_2);
    const failing = stubGenerator();
    failing.failNextWith = new APIConnectionError({});
    await expect(
      createGenerateTask({
        handle: harness.handle,
        publicBaseUrl: PUBLIC_URL,
        generator: failing,
        github: stubGitHub(HEAD_2),
      })(payload),
    ).rejects.toThrow("Connection error");
    const failed = await createGenerationProjection(harness.handle, ctx).get(
      target(pr, HEAD_2),
    );
    expect(failed?.status).toBe(GenerationStatuses.FAILED);
    expect(failed?.errorCode).not.toBeNull();

    // The retry: at cap now, so the run is skipped, but the record stays.
    const generator = stubGenerator();
    await createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_2),
      spend: { dailyGenerationCap: 1, perRepo: {} },
    })(payload);

    expect(generator.calls).toEqual([]);
    const afterRetry = await createGenerationProjection(
      harness.handle,
      ctx,
    ).get(target(pr, HEAD_2));
    expect(afterRetry?.status).toBe(GenerationStatuses.FAILED);
    expect(afterRetry?.errorCode).toBe(failed?.errorCode);
  });

  it("a per-repo override beats the instance default", async () => {
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const generator = stubGenerator();
    await createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_2),
      // The default would cap this run; the override raises it.
      spend: { dailyGenerationCap: 1, perRepo: { "acme/widget": 10 } },
    })(payload);

    expect(generator.calls).toContain("brief");
    expect(
      (
        await createGenerationProjection(harness.handle, ctx).get(
          target(pr, HEAD_2),
        )
      )?.status,
    ).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("leaves zero-config jobs uncapped", async () => {
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const generator = stubGenerator();
    await createGenerateTask({
      handle: harness.handle,
      publicBaseUrl: PUBLIC_URL,
      generator,
      github: stubGitHub(HEAD_2),
    })(payload);

    expect(generator.calls).toContain("brief");
    expect(
      (
        await createGenerationProjection(harness.handle, ctx).get(
          target(pr, HEAD_2),
        )
      )?.status,
    ).toBe(GenerationStatuses.SUCCEEDED);
  });
});
