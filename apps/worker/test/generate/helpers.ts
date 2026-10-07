// Use migrated PGlite, a graphile queue stub and fake model/GitHub ports without network.
import { beforeEach } from "vitest";
import {
  createIngestRoutines,
  GenerationKinds,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  parseTenantContext,
  type GenerationTarget,
  type PullRequestRow,
  type RepoId,
  type ReviewerId,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { z } from "zod/v4";
import {
  GeneratorError,
  GeneratorErrorKinds,
  type Effort,
  type GenerateRequest,
  type Generator,
} from "generators";
import { createLogger, type Logger } from "logging";
import type { Result } from "types/utils";
import type { CompareFile } from "brief-core";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type {
  GitHubApiError,
  IssueInfo,
  PullRequestFile,
  PullRequestInfo,
  RepoFileResult,
} from "github";
import {
  createGenerateTask,
  type GenerateTaskDeps,
} from "../../src/task/generate";
import type { GenerateTask } from "../../src/task/generate/types";
import type { GitHubPort, PullRequestSource } from "../../src/task/github-port";

export const HEAD_1 = "a".repeat(40);
export const HEAD_2 = "b".repeat(40);
export const BASE = "c".repeat(40);
export const PUBLIC_URL = "https://brief.example";

const SMALL_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
`;

export const CUSTOM_RISK = "touches-billing";
export const CUSTOM_RISK_POLICY = `version: 1
attributes:
  ${CUSTOM_RISK}:
    criteria: modifies invoicing code
`;

export function makeRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) {
    throw new Error("bad repo id");
  }
  return value;
}

export function makeReviewerId(value: bigint): ReviewerId {
  if (!isReviewerId(value)) {
    throw new Error("bad reviewer id");
  }
  return value;
}

export interface StubGenerator extends Generator {
  readonly calls: string[];
  /** Canned outputs by label, tests may override an entry. */
  readonly outputs: Record<string, unknown>;
  /** Every request's prompt surfaces, for injection assertions. */
  readonly requests: { label: string; system: string; user: string }[];
  failNextWith?: unknown;
}

/** A statusless connection failure as every API adapter hands it over. */
export function makeConnectionError(): GeneratorError {
  return new GeneratorError(
    GeneratorErrorKinds.PROVIDER_TRANSIENT,
    "Connection error.",
    { cause: new Error("socket hang up") },
  );
}

/** Dispatches canned, schema-minimal outputs by label. */
export function stubGenerator(): StubGenerator {
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
      if (output === undefined) {
        throw new Error(`no stub output for ${req.label}`);
      }
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

export interface StubGitHub extends GitHubPort {
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
  fetchPullRequestFilesError?: GitHubApiError;
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
  urlBoxCalls: {
    grantId: bigint;
    repoSlug: string;
    prNumber: number;
    ownerUserId: bigint;
  }[];
  /** Issues by `owner/repo#n`; missing = not found (404). */
  issues: Map<string, IssueInfo>;
  /** Open PRs in the repo; empty means no stack. */
  openPullRequests: OpenPullRequest[];
  listOpenPullRequestsError?: GitHubApiError;
}

function makeOk<Value>(value: Value): Result<Value, GitHubApiError> {
  return { ok: true, value };
}

export function stubGitHub(headSha: string): StubGitHub {
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
      updatedAt: new Date("2026-09-20T10:00:00Z"),
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
    async openUrlBoxPullRequestSource(
      grantId,
      repoSlug,
      prNumber,
      ownerUserId,
    ) {
      stub.urlBoxCalls.push({ grantId, repoSlug, prNumber, ownerUserId });
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
        return makeOk(
          scripted === undefined
            ? stub.info
            : { ...stub.info, headSha: scripted },
        );
      },
      fetchPullRequestFiles: async () => {
        if (stub.fetchPullRequestFilesError) {
          return { ok: false, error: stub.fetchPullRequestFilesError };
        }
        return makeOk(stub.files);
      },
      listOpenPullRequests: async () => {
        if (stub.listOpenPullRequestsError) {
          return { ok: false, error: stub.listOpenPullRequestsError };
        }
        return makeOk(stub.openPullRequests);
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
        return makeOk(issue);
      },
      fetchDiff: async () => makeOk(stub.diff),
      fetchCompareDiff: async (base: string, head: string) =>
        makeOk(stub.compareDiffs.get(`${base}...${head}`) ?? SMALL_DIFF),
      fetchCompareFiles: async (base: string, head: string) => {
        if (stub.fetchCompareFilesError) {
          return { ok: false, error: stub.fetchCompareFilesError };
        }
        return makeOk(
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
        return makeOk(stub.repoFiles.get(path) ?? { kind: "absent" as const });
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
        return makeOk({ commentId });
      },
      deleteComment: async (commentId: bigint) => {
        if (stub.deleteCommentError) {
          return { ok: false, error: stub.deleteCommentError };
        }
        // Mirrors the real adapter: a 404 (unknown id) maps to ok.
        stub.comments.delete(commentId);
        stub.commentCalls.push(`delete:${commentId}`);
        return makeOk(undefined);
      },
      fetchComment: async (commentId: bigint) => {
        if (stub.fetchCommentError) {
          return { ok: false, error: stub.fetchCommentError };
        }
        stub.commentCalls.push(`fetch:${commentId}`);
        const body = stub.comments.get(commentId);
        // Mirrors the real adapter: a 404 (unknown id) maps to ok undefined.
        return makeOk(body === undefined ? undefined : { body });
      },
    };
  }
  return stub;
}

export function buildRepoFile(
  content: string,
  blobSha: string,
): RepoFileResult {
  return {
    kind: "file",
    content,
    blobSha,
    size: Buffer.byteLength(content, "utf8"),
  };
}

export interface CapturedLogger {
  logger: Logger;
  readLines: () => Array<Record<string, unknown>>;
}

export function captureLogger(
  env: Record<string, string> = {},
): CapturedLogger {
  const written: string[] = [];
  const logger = createLogger({
    env,
    destination: { write: (line: string) => void written.push(line) },
  });
  function readLines(): Array<Record<string, unknown>> {
    return written.map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error(`expected NDJSON object: ${line}`);
      }
      return { ...parsed };
    });
  }
  return { logger, readLines };
}

export let harness: PgliteHarness;
export const ctx = parseTenantContext({ installationId: 42 });

/** Gives every test in the calling file a fresh migrated PGlite `harness`. */
export function setUpHarness(): void {
  beforeEach(async () => {
    harness = await createPgliteHarness();
    return async () => {
      await harness.close();
    };
  });
}

export interface TriggeredJob {
  pr: PullRequestRow;
  payload: unknown;
}

/** Enqueue via the REAL ingest boundary and return {pr row, job payload}. */
export async function trigger(headSha: string): Promise<TriggeredJob> {
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
  if (!outcome.ok) {
    throw new Error(outcome.error.message);
  }
  const jobs = await harness.raw(
    "select payload from graphile_worker.jobs where task_identifier = 'generate'",
  );
  const payload = jobs.at(-1)?.["payload"];
  return { pr: outcome.value.pullRequest, payload };
}

export function makeTarget(
  pr: PullRequestRow,
  headSha: string,
): GenerationTarget {
  if (!isPullRequestRowId(pr.id)) {
    throw new Error("bad pr id");
  }
  return {
    pullRequestId: pr.id,
    kind: GenerationKinds.BRIEF,
    headSha,
    baselineSha: null,
  };
}

/** The task over this test's harness, a fresh stub generator and a HEAD_1 GitHub stub. */
export function makeTask(
  overrides: Partial<GenerateTaskDeps> = {},
): GenerateTask {
  return createGenerateTask({
    handle: harness.handle,
    publicBaseUrl: PUBLIC_URL,
    generator: stubGenerator(),
    github: stubGitHub(HEAD_1),
    ...overrides,
  });
}
