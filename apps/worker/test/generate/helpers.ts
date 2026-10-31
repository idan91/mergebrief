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
import {
  SINGLE_CALL_MAX_HUNKS,
  createBuiltInContextProviders,
  parseChangedRanges,
  type CompareFiles,
} from "brief-core";
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
import { RunPools, type GenerateTask } from "../../src/task/generate/types";
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

export const SMALL_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
`;

/** One hunk past the single-call hunk limit, in one file. */
export const MANY_HUNKS_DIFF = `diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n${"@@ -1 +1 @@\n-x\n+y\n".repeat(SINGLE_CALL_MAX_HUNKS + 1)}`;

/** Whole-PR churn large enough that no span reaches the huge-span ratio. */
export const LARGE_PR_FILES = [
  { path: "a.ts", additions: 100_000, deletions: 0 },
];

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

function makeStubIntentCheck() {
  return {
    ticketUrls: [],
    ticketTitles: [],
    specificity: "none",
    scopeNote: "",
    items: [],
    alignment: { read: "", goal: "", response: "" },
  };
}

function makeStubChangeGroup() {
  return {
    id: "g1",
    title: "stub group",
    summary: "stub group summary",
    dominantCategory: "bugfix",
    secondaryCategories: [],
    uncertain: false,
    uncertainBetween: [],
  };
}

const GROUPING_LABEL = "grouping";
const DETAIL_LABEL_PREFIX = "detail:";
const PR_DIFF_OPEN = "<pr_diff>\n";
const PR_DIFF_CLOSE = "\n</pr_diff>";
const DIFF_FILE_HEADER = "diff --git ";
const OUTLINE_FILE_TITLE = /^### (f\d+) /;
const DETAIL_HUNK_MARKER = /^\[hunk \S+ -> (\S+)\]$/;

/** One detail-call hunk as a standalone patch: its file's diff header, then the hunk. */
interface MarkedHunk {
  groupId: string;
  lines: string[];
}

/** Dispatches canned, schema-minimal outputs by label. */
export function stubGenerator(): StubGenerator {
  const calls: string[] = [];
  const requests: { label: string; system: string; user: string }[] = [];
  const outputs: Record<string, unknown> = {
    brief: {
      summary: "stub brief",
      intentCheck: makeStubIntentCheck(),
      changeGroups: [makeStubChangeGroup()],
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

function sliceDiffBlock(user: string): string {
  const start = user.lastIndexOf(PR_DIFF_OPEN) + PR_DIFF_OPEN.length;
  return user.slice(start, user.indexOf(PR_DIFF_CLOSE, start));
}

/** Every file of the outline in one group, each assigned whole. */
function answerGrouping(user: string): unknown {
  const fileIds = sliceDiffBlock(user)
    .split("\n")
    .flatMap((line) => {
      const [, fileId] = OUTLINE_FILE_TITLE.exec(line) ?? [];
      return fileId === undefined ? [] : [fileId];
    });

  const group = makeStubChangeGroup();

  return {
    summary: "stub grouping",
    changeGroups: [group],
    readingOrder: [{ groupId: group.id, why: "the one group" }],
    intentCheck: makeStubIntentCheck(),
    hunkMap: [{ groupId: group.id, hunks: fileIds }],
  };
}

/** Splits a detail batch's diff into one patch per hunk marker, keyed by the marker's group. */
function listMarkedHunks(user: string): MarkedHunk[] {
  const hunks: MarkedHunk[] = [];
  let fileHeader: string[] = [];
  let current: MarkedHunk | undefined;
  for (const line of sliceDiffBlock(user).split("\n")) {
    if (line.startsWith(DIFF_FILE_HEADER)) {
      current = undefined;
      fileHeader = [line];
      continue;
    }
    const [, groupId] = DETAIL_HUNK_MARKER.exec(line) ?? [];
    if (groupId !== undefined) {
      current = { groupId, lines: [...fileHeader] };
      hunks.push(current);
      continue;
    }
    if (current === undefined) {
      fileHeader.push(line);
    } else {
      current.lines.push(line);
    }
  }

  return hunks;
}

/** One chunk per hunk marker, in its marker's group. */
function answerDetail(user: string): unknown {
  const files = listMarkedHunks(user).flatMap((hunk) => {
    const patch = hunk.lines.join("\n");
    return parseChangedRanges(patch).map((file) => ({
      groupId: hunk.groupId,
      file,
    }));
  });

  return {
    chunks: files.map(({ groupId, file }, index) => ({
      id: `c${index + 1}`,
      changeGroupId: groupId,
      file: file.file,
      concern: "implementation",
      role: "core",
      addedRanges: file.addedRanges,
      removedRanges: file.removedRanges,
      riskSurface: [],
    })),
  };
}

function answerMultiCall(label: string, user: string): unknown {
  if (label === GROUPING_LABEL) {
    return answerGrouping(user);
  }
  if (label.startsWith(DETAIL_LABEL_PREFIX)) {
    return answerDetail(user);
  }
  return undefined;
}

/**
 * `stubGenerator` that also answers a multi-call run's grouping and detail
 * calls, and cuts every call whose label `cutLabels` names, as a model
 * reaching its output cap does. A cut call is recorded in `calls`.
 */
export function stubMultiCallGenerator(
  cutLabels: readonly string[] = [],
): StubGenerator {
  const single = stubGenerator();
  const generator: StubGenerator = {
    calls: single.calls,
    outputs: single.outputs,
    requests: single.requests,
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      if (generator.failNextWith !== undefined) {
        single.failNextWith = generator.failNextWith;
        generator.failNextWith = undefined;
        return single.generate(req);
      }
      if (cutLabels.includes(req.label)) {
        single.calls.push(req.label);
        throw new GeneratorError(
          GeneratorErrorKinds.OUTPUT_CUT,
          `${req.label} reached its output token cap before it finished`,
        );
      }
      const answer = answerMultiCall(req.label, req.user);
      if (answer === undefined) {
        return single.generate(req);
      }
      single.calls.push(req.label);
      single.requests.push({
        label: req.label,
        system: req.system,
        user: req.user,
      });
      return req.schema.parse(answer);
    },
    origin: (effort: Effort) => single.origin(effort),
  };
  return generator;
}

/** A 90-hunk PR over three files: two detail batches on the multi-call path. */
export const MULTI_CALL_PATHS = ["src/a.ts", "src/b.ts", "src/c.ts"];
const MULTI_CALL_HUNKS_PER_FILE = 30;

function makeHunkedFileDiff(path: string, hunks: number): string {
  const lines = Array.from({ length: hunks }, (_, index) => [
    `@@ -${index * 10 + 1},1 +${index * 10 + 1},1 @@`,
    "-old",
    "+new",
  ]).flat();
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...lines,
    "",
  ].join("\n");
}

export const MULTI_CALL_DIFF = MULTI_CALL_PATHS.map((path) =>
  makeHunkedFileDiff(path, MULTI_CALL_HUNKS_PER_FILE),
).join("");

export const MULTI_CALL_FILES: readonly PullRequestFile[] =
  MULTI_CALL_PATHS.map((path) => ({
    path,
    additions: MULTI_CALL_HUNKS_PER_FILE,
    deletions: MULTI_CALL_HUNKS_PER_FILE,
  }));

/** PR #7 at `headSha` over `MULTI_CALL_DIFF`, or one 30-hunk file per path given. */
export function makeMultiCallGitHub(
  headSha: string,
  paths: readonly string[] = MULTI_CALL_PATHS,
): FakeGitHub {
  if (paths === MULTI_CALL_PATHS) {
    return makeGitHub(headSha, MULTI_CALL_FILES, MULTI_CALL_DIFF);
  }

  const diff = paths
    .map((path) => makeHunkedFileDiff(path, MULTI_CALL_HUNKS_PER_FILE))
    .join("");
  const files = paths.map((path) => ({
    path,
    additions: MULTI_CALL_HUNKS_PER_FILE,
    deletions: MULTI_CALL_HUNKS_PER_FILE,
  }));
  return makeGitHub(headSha, files, diff);
}

function makeStubGroup(id: string) {
  return {
    id,
    title: `Group ${id}`,
    summary: `What ${id} does.`,
    dominantCategory: "logic-refactor",
    secondaryCategories: [],
    uncertain: false,
    uncertainBetween: [],
  };
}

/** One group per file, read g2 first: g2 and g1 fill batch 1, g3 is batch 2. */
export const MULTI_CALL_GROUPING = {
  summary: "Refactors three modules.",
  changeGroups: [makeStubGroup("g1"), makeStubGroup("g2"), makeStubGroup("g3")],
  hunkMap: [
    { groupId: "g1", hunks: ["f1"] },
    { groupId: "g2", hunks: ["f2"] },
    { groupId: "g3", hunks: ["f3"] },
  ],
  readingOrder: [
    { groupId: "g2", why: "the main change" },
    { groupId: "g1", why: "builds on it" },
    { groupId: "g3", why: "side change" },
  ],
  intentCheck: {
    ticketUrls: [],
    ticketTitles: [],
    specificity: "none",
    scopeNote: "",
    items: [],
    alignment: { read: "", goal: "", response: "" },
  },
};

/**
 * One group per file of a `makeMultiCallGitHub` diff over `count` paths,
 * read in file order: two 30-hunk groups fill a detail batch.
 */
export function makeInOrderGrouping(count: number): typeof MULTI_CALL_GROUPING {
  const ids = Array.from({ length: count }, (_, index) => `g${index + 1}`);
  return {
    ...MULTI_CALL_GROUPING,
    changeGroups: ids.map(makeStubGroup),
    hunkMap: ids.map((groupId, index) => ({
      groupId,
      hunks: [`f${index + 1}`],
    })),
    readingOrder: ids.map((groupId) => ({ groupId, why: "in file order" })),
  };
}

/** The detail prompt's hunk marker and the hunk header right after it. */
const THREE_GROUP_HUNK_MARKER =
  /\[hunk (f\d+)h(\d+) -> (\S+)\]\n@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;

/** The path a file id names: the `diff --git` header right before its first marker. */
function readMarkedPath(user: string, fileId: string): string {
  const marker = user.indexOf(`[hunk ${fileId}h`);
  const header = user.lastIndexOf("diff --git a/", marker);
  const line = user.slice(header, user.indexOf("\n", header));
  return line.replace(/^diff --git a\/(\S+) b\/.*$/, "$1");
}

/** One core chunk per hunk marker in a detail request, its ranges read off the hunk header. */
export function answerDetailRequest(user: string) {
  const chunks = [...user.matchAll(THREE_GROUP_HUNK_MARKER)].map(
    (match, position) => {
      const start = Number(match[4]);
      const count = Number(match[5] ?? "1");
      return {
        id: `c${position + 1}`,
        changeGroupId: match[3],
        file: readMarkedPath(user, match[1] ?? ""),
        concern: "implementation",
        role: "core",
        addedRanges: [{ start, end: start + count - 1 }],
        removedRanges: [{ start, end: start + count - 1 }],
        riskSurface: [],
      };
    },
  );
  return { chunks };
}

export interface ThreeGroupStubGenerator extends Generator {
  /** Every request's label, in call order. */
  readonly calls: string[];
  /** Throws `error` from the label's next call, once. */
  failOn(label: string, error: unknown): void;
  /** Runs before each call answers; a test interleaves a push or a shutdown here. */
  onCall?: (label: string) => Promise<void>;
}

/**
 * Answers the grouping call with `grouping`, each detail call
 * with one chunk per hunk in its batch, and every other label as
 * `stubGenerator` does. A call whose signal is already aborted rejects as
 * a stream cut short does.
 */
export function stubThreeGroupGenerator(
  grouping: typeof MULTI_CALL_GROUPING = MULTI_CALL_GROUPING,
): ThreeGroupStubGenerator {
  const base = stubGenerator();
  const calls: string[] = [];
  const failures = new Map<string, unknown>();
  const generator: ThreeGroupStubGenerator = {
    calls,
    failOn(label, error) {
      failures.set(label, error);
    },
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      calls.push(req.label);
      await generator.onCall?.(req.label);
      if (req.signal?.aborted === true) {
        throw makeAbortError();
      }
      if (failures.has(req.label)) {
        const failure = failures.get(req.label);
        failures.delete(req.label);
        throw failure;
      }
      if (req.label === "grouping") {
        return req.schema.parse(grouping);
      }
      if (req.label.startsWith("detail:")) {
        return req.schema.parse(answerDetailRequest(req.user));
      }
      return base.generate(req);
    },
    origin: (effort: Effort) => base.origin(effort),
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
    additions: 8,
    deletions: 2,
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
  diff = SMALL_DIFF,
): FakeGitHub {
  const github = makeFakeGitHub();
  github.addPullRequest(PR_REF, {
    info: makePullRequestInfo(headSha),
    files,
    diff,
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

const COMMENT_VERBS: Readonly<Record<string, string>> = {
  deleteComment: "delete",
  editComment: "edit",
  fetchComment: "fetch",
};

/** The bodies of the comments live on the fake's PR #7 repository. */
export function readLiveBodies(github: FakeGitHub): string[] {
  return [...github.readComments(REPO).values()];
}

/** The Entry comment calls in order: `post`, `delete:<id>`, `edit:<id>`, `fetch:<id>`. */
export function listCommentCalls(github: FakeGitHub): string[] {
  const calls = github.calls.filter(
    (call) =>
      call.operation === "postEntryComment" ||
      COMMENT_VERBS[call.operation] !== undefined,
  );
  return calls.map((call) => {
    if (call.operation === "postEntryComment") {
      return "post";
    }
    const { commentId } = call.input as { commentId: bigint };
    return `${COMMENT_VERBS[call.operation]}:${commentId}`;
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

/** The large pool's generate task over the same defaults as `makeTask`. */
export function makeLargePoolTask(overrides: TaskOverrides = {}): GenerateTask {
  return createGenerateTask(makeTaskDeps(overrides), { pool: RunPools.LARGE });
}

/** The Entry sync task over the same defaults as `makeTask`. */
export function makeSyncEntryTask(overrides: TaskOverrides = {}): GenerateTask {
  return createSyncEntryTask(makeTaskDeps(overrides));
}
