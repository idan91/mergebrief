// Use migrated PGlite, a graphile queue stub, a stub model and github/testing's fake GitHub.
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach } from "vitest";
import {
  createEnvKeyProvider,
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  GenerationKinds,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  MAX_GENERATION_ATTEMPTS,
  parseTenantContext,
  type GenerationTarget,
  type GrantRowId,
  type KeyProvider,
  type PullRequestRow,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "persistence";
import type { GenerationStatus } from "types/generations";
import { PrStates } from "types/pull-requests";
import {
  createPgliteHarness,
  type PgliteHarness,
  seedGrant,
} from "persistence/testing";
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
import { createLogger, type Logger } from "logging";
import type { Mutable } from "types/utils";
import { createBuiltInContextProviders, type CompareFiles } from "brief-core";
import type {
  InstallationRepoClient,
  OwnedOperatorToken,
  PullRequestFile,
  PullRequestInfo,
  PullRequestRef,
  RepoFileResult,
  RepoReader,
  RepositoryRef,
  ReviewerRepoClient,
} from "github";
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createGenerateTask,
  createRecoverGenerationTask,
  createSyncEntryTask,
  type GenerateTaskDeps,
} from "../../src/task/generate";
import {
  buildEntryCommentCappedBody,
  type EntryCommentLink,
} from "../../src/task/entry-comment";
import type { GenerateTask } from "../../src/task/generate/types";
import {
  createGitHubPort,
  type GitHubPort,
  type UrlBoxAuthDeps,
} from "../../src/task/github-port";

export const HEAD_1 = "a".repeat(40);
export const HEAD_2 = "b".repeat(40);
export const BASE = "c".repeat(40);
export const PUBLIC_URL = "https://brief.example";
export const FIRST_ATTEMPT = {
  attempts: 1,
  max_attempts: MAX_GENERATION_ATTEMPTS,
  run_at: new Date(),
} as const;
export const SECOND_ATTEMPT = { ...FIRST_ATTEMPT, attempts: 2 } as const;
/** graphile's final attempt: no retry follows a failure here. */
export const LAST_ATTEMPT = {
  ...FIRST_ATTEMPT,
  attempts: FIRST_ATTEMPT.max_attempts,
} as const;

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

function makeAbortError(): Error {
  return Object.assign(new Error("Request was aborted."), {
    name: "APIUserAbortError",
  });
}

/**
 * Every call runs `onCall`, then waits for the request's abort and rejects
 * with the SDK's abort shape, as a stream cut short does.
 */
export function stubHangingGenerator(
  onCall: () => Promise<void> = async () => {},
): Generator {
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      await onCall();
      return new Promise<never>((_, reject) => {
        if (req.signal?.aborted === true) {
          reject(makeAbortError());
          return;
        }
        req.signal?.addEventListener("abort", () => reject(makeAbortError()));
      });
    },
    origin: (effort: Effort) => ({
      provider: "stub",
      model: "stub-model",
      effort,
    }),
  };
}

/** Dispatches canned, schema-minimal outputs by label. */
export function stubGenerator(): StubGenerator {
  const calls: string[] = [];
  const requests: { label: string; system: string; user: string }[] = [];
  const outputs: Record<string, unknown> = {
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

export const REPO: RepositoryRef = { owner: "acme", repo: "widget" };
export const PR_REF: PullRequestRef = { ...REPO, prNumber: 7 };
export const VIEWER_TOKEN = "ghu_viewer";
const VIEWER_ID = 100n;

const KEY_REF = "SESSION_KEY_TEST";
export const TEST_KEY_PROVIDER = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});

const FIXTURE_COMMITS = [BASE, HEAD_1, HEAD_2];

export function makePullRequestInfo(headSha: string): PullRequestInfo {
  return {
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
    changedFiles: 1,
    authorLogin: "octocat",
    authorIsBot: false,
    closedAt: null,
    updatedAt: new Date("2026-09-20T10:00:00Z"),
    headRepo: { owner: "acme", repo: "widget" },
    baseRepo: { owner: "acme", repo: "widget" },
  };
}

/** A span's compare; its files default to the conservative nothing-confirmable answer. */
export function arrangeCompare(
  github: FakeGitHub,
  span: { readonly base: string; readonly head: string },
  diff = SMALL_DIFF,
  files: CompareFiles = { files: [], complete: false },
): void {
  github.addCompare(REPO, span, { diff, files });
}

/** PR #7 at `headSha`; every span between the fixture commits diffs as `SMALL_DIFF`. */
export function makeGitHub(
  headSha: string,
  files: readonly PullRequestFile[] = [
    { path: "a.ts", additions: 8, deletions: 2 },
  ],
): FakeGitHub {
  const github = makeFakeGitHub();
  github.addPullRequest(PR_REF, {
    info: makePullRequestInfo(headSha),
    files,
    diff: SMALL_DIFF,
  });
  for (const base of FIXTURE_COMMITS) {
    for (const head of FIXTURE_COMMITS) {
      if (base !== head) {
        arrangeCompare(github, { base, head });
      }
    }
  }
  return github;
}

/** GitHub refuses the PR's diff for good: the PR diff and its compare fallback both 406. */
export function refuseDiffs(github: FakeGitHub): void {
  github.failOn("fetchDiff", FakeFailures.NOT_ACCEPTABLE);
  github.failOn("fetchCheckedCompareDiff", FakeFailures.NOT_ACCEPTABLE);
}

/** The task's port over the fake, with the url-box path over this harness's grants. */
export function openTestPort(
  github: FakeGitHub,
  operatorToken?: OwnedOperatorToken,
): GitHubPort {
  const urlBox: Mutable<UrlBoxAuthDeps> = {
    handle: harness.handle,
    keyProvider: TEST_KEY_PROVIDER,
  };
  if (operatorToken !== undefined) {
    urlBox.operatorToken = operatorToken;
  }
  return createGitHubPort(github, urlBox);
}

/**
 * A stored grant sealing `token` under the test key; `keyRef` is the name
 * recorded on the row, so a ref the test provider lacks leaves it unreadable.
 */
export async function seedViewerGrant(
  token = VIEWER_TOKEN,
  keyRef = KEY_REF,
): Promise<GrantRowId> {
  const sealingProvider: KeyProvider = {
    resolveKey: () => TEST_KEY_PROVIDER.resolveKey(KEY_REF),
  };
  const grant = await seedGrant(harness.handle, {
    userId: makeReviewerId(VIEWER_ID),
    accessToken: token,
    refreshToken: "refresh",
    keyProvider: sealingProvider,
    keyRef,
    refreshExpiresAt: new Date(Date.now() + 3_600_000),
  });
  return grant.id;
}

/** Wraps each repo client the task binds as the installation: an interleaving the fake cannot arrange. */
export function interceptInstallationRepo(
  github: FakeGitHub,
  wrap: (client: InstallationRepoClient) => InstallationRepoClient,
): void {
  const bind = github.bindInstallationGitHub.bind(github);
  github.bindInstallationGitHub = (installationId) => {
    const bound = bind(installationId);
    return { ...bound, forRepo: (repo) => wrap(bound.forRepo(repo)) };
  };
}

/** As `interceptInstallationRepo`, for the viewer's binding on a url-box job. */
export function interceptReviewerRepo(
  github: FakeGitHub,
  wrap: (client: ReviewerRepoClient) => ReviewerRepoClient,
): void {
  const bind = github.bindReviewerGitHub.bind(github);
  github.bindReviewerGitHub = (credential, options) => {
    const bound = bind(credential, options);
    return { ...bound, forRepo: (repo) => wrap(bound.forRepo(repo)) };
  };
}

function wrapFirstHeadRead<Client extends RepoReader>(
  client: Client,
  onRead: () => void,
): Client {
  return {
    ...client,
    async fetchPullRequest(prNumber: number) {
      const read = await client.fetchPullRequest(prNumber);
      onRead();
      return read;
    },
  };
}

/** The first head read sees the arranged head; every later one sees `nextHead`. */
export function pushHeadAfterFirstRead(
  github: FakeGitHub,
  nextHead: string,
): void {
  let reads = 0;
  function onRead(): void {
    reads += 1;
    if (reads === 1) {
      github.updatePullRequest(PR_REF, { headSha: nextHead });
    }
  }
  interceptInstallationRepo(github, (client) =>
    wrapFirstHeadRead(client, onRead),
  );
  interceptReviewerRepo(github, (client) => wrapFirstHeadRead(client, onRead));
}

/** A newer head's Entry comment another run stored. */
export const NEWER_COMMENT_ID = 9_001n;
export const NEWER_BODY = "A newer head's Entry comment";

/** The first head read answers; GitHub fails every later one. */
export function failHeadReadsAfterFirst(github: FakeGitHub): void {
  let reads = 0;
  function onRead(): void {
    reads += 1;
    if (reads === 1) {
      github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
    }
  }
  interceptInstallationRepo(github, (client) =>
    wrapFirstHeadRead(client, onRead),
  );
}

const COMMENT_OPERATIONS = new Set<string>([
  "postEntryComment",
  "deleteComment",
  "fetchComment",
]);

/** The bodies of the comments live on the fake's PR #7 repository. */
export function readLiveBodies(github: FakeGitHub): string[] {
  return [...github.readComments(REPO).values()];
}

/** The Entry comment calls in order: `post`, `delete:<id>`, `fetch:<id>`. */
export function listCommentCalls(github: FakeGitHub): string[] {
  const calls = github.calls.filter((call) =>
    COMMENT_OPERATIONS.has(call.operation),
  );
  return calls.map((call) => {
    if (call.operation === "postEntryComment") {
      return "post";
    }
    const { commentId } = call.input as { commentId: bigint };
    const verb = call.operation === "deleteComment" ? "delete" : "fetch";
    return `${verb}:${commentId}`;
  });
}

/** Every `pull_request` query fails while `run` runs, as a dead pooled connection would; other tables still answer. */
export async function runWithPullRequestsOffline<Value>(
  run: () => Promise<Value>,
): Promise<Value> {
  await harness.raw("alter table pull_request rename to pull_request_offline");
  try {
    return await run();
  } finally {
    await harness.raw(
      "alter table pull_request_offline rename to pull_request",
    );
  }
}

/** Runs `hook` after each accepted Entry post, before the post returns. */
export function runAfterEachPost(
  github: FakeGitHub,
  hook: () => Promise<void>,
): void {
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async postEntryComment(input) {
      const posted = await client.postEntryComment(input);
      if (posted.ok) {
        await hook();
      }
      return posted;
    },
  }));
}

/** Another slot's Entry post landing inside this run's round trip: its comment, swapped onto the row. */
export async function storeAnotherRunsEntry(
  github: FakeGitHub,
  pullRequestId: PullRequestRowId,
  comment: { readonly id: bigint; readonly body: string },
): Promise<void> {
  github.addComment(REPO, comment.id, comment.body);
  const { pullRequests } = createTenantRepository(harness.handle, ctx);
  const row = await pullRequests.getById(pullRequestId);
  await pullRequests.swapEntryComment(pullRequestId, {
    seen: row?.entryCommentId ?? null,
    next: comment.id,
  });
}

/** The id an Entry body seeded by `trackEntryBody` takes. */
export const SEEDED_ENTRY_ID = 9_101n;

/** The thread holds only `body`, tracked on the row as its Entry comment. */
export async function trackEntryBody(
  github: FakeGitHub,
  pullRequestId: PullRequestRowId,
  body: string,
): Promise<void> {
  for (const commentId of github.readComments(REPO).keys()) {
    github.removeComment(REPO, commentId);
  }
  await storeAnotherRunsEntry(github, pullRequestId, {
    id: SEEDED_ENTRY_ID,
    body,
  });
}

/** HEAD_1's capped Entry, whose reset time is a part no rebuilt body matches. */
export async function trackCappedEntry(
  github: FakeGitHub,
  pullRequestId: PullRequestRowId,
): Promise<void> {
  const body = buildEntryCommentCappedBody(createI18n().t, {
    ...ENTRY_PR_VIEW,
    headSha: HEAD_1,
    resetsAt: new Date(),
  });
  await trackEntryBody(github, pullRequestId, body);
}

/** Entry comment calls GitHub accepted, with the ids it answered: `post:<id>`, `delete:<id>`, `fetch:<id>`. */
export function recordCommentCalls(github: FakeGitHub): string[] {
  const calls: string[] = [];
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async postEntryComment(input) {
      const posted = await client.postEntryComment(input);
      if (posted.ok) {
        calls.push(`post:${posted.value.commentId}`);
      }
      return posted;
    },
    async deleteComment(commentId) {
      const deleted = await client.deleteComment(commentId);
      if (deleted.ok) {
        calls.push(`delete:${commentId}`);
      }
      return deleted;
    },
    async fetchComment(commentId) {
      const fetched = await client.fetchComment(commentId);
      if (fetched.ok) {
        calls.push(`fetch:${commentId}`);
      }
      return fetched;
    },
  }));
  return calls;
}

/** Every repo-file path read, in order. */
export function listRepoFilePaths(github: FakeGitHub): string[] {
  const calls = github.listCalls("fetchRepoFile");
  return calls.map((call) => (call.input as { path: string }).path);
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

/** One migrated PGlite `harness` for the calling file: its tests must share no rows. */
export function setUpFileHarness(): void {
  beforeAll(async () => {
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

export interface TriggerOptions {
  /** The webhook's author gate: the PR author is not a trusted author. */
  readonly requiresTriggerApproval?: boolean;
}

/** Enqueue via the REAL ingest boundary and return {pr row, job payload}. */
export async function trigger(
  headSha: string,
  options: TriggerOptions = {},
): Promise<TriggeredJob> {
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
    ...options,
  });
  const jobs = await harness.raw(
    "select payload from graphile_worker.jobs where task_identifier = 'generate'",
  );
  const payload = jobs.at(-1)?.["payload"];
  return { pr: outcome.pullRequest, payload };
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

/** The status the head's row holds now, or none when it has no row. */
export async function readRowStatus(
  pr: PullRequestRow,
  headSha: string,
): Promise<GenerationStatus | undefined> {
  const projection = createGenerationProjection(harness.handle, ctx);
  const row = await projection.get(makeTarget(pr, headSha));
  return row?.status;
}

/** The `rev` the PR's first brief takes. */
export const FIRST_BRIEF_INDEX = 1;

/** The seeded PR #7's view in the Entry links a run builds. */
export const ENTRY_PR_VIEW = {
  publicBaseUrl: PUBLIC_URL,
  repoId: makeRepoId(7n),
  prNumber: 7,
} as const;

/** The Entry link a run builds for `headSha` on PR #7. */
export function makeEntryLink(
  headSha: string,
  headIndex = FIRST_BRIEF_INDEX,
): EntryCommentLink {
  return { ...ENTRY_PR_VIEW, headIndex, headSha };
}

/** Deps a test varies; `github` is the fake the task's port binds. */
export interface TaskOverrides extends Omit<
  Partial<GenerateTaskDeps>,
  "github"
> {
  readonly github?: FakeGitHub;
  readonly operatorToken?: OwnedOperatorToken;
}

function makeTaskDeps(overrides: TaskOverrides): GenerateTaskDeps {
  const { github = makeGitHub(HEAD_1), operatorToken, ...rest } = overrides;
  return {
    handle: harness.handle,
    publicBaseUrl: PUBLIC_URL,
    translate: createI18n().t,
    generator: stubGenerator(),
    contextProviders: createBuiltInContextProviders(DEFAULT_LINK_FETCH),
    ...rest,
    github: openTestPort(github, operatorToken),
  };
}

/** The task over this test's harness, a fresh stub generator and a HEAD_1 fake GitHub. */
export function makeTask(overrides: TaskOverrides = {}): GenerateTask {
  return createGenerateTask(makeTaskDeps(overrides));
}

/** The recovery task over the same defaults as `makeTask`. */
export function makeRecoveryTask(overrides: TaskOverrides = {}): GenerateTask {
  return createRecoverGenerationTask(makeTaskDeps(overrides));
}

/** The Entry sync task over the same defaults as `makeTask`. */
export function makeSyncEntryTask(overrides: TaskOverrides = {}): GenerateTask {
  return createSyncEntryTask(makeTaskDeps(overrides));
}
