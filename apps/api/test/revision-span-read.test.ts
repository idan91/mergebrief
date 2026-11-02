// The diff read over a pair a marks row certifies, through app.request over
// PGlite: the span is read on the github/testing fake, its line diffs on the
// app's own thread, and compared with the in-process read of the same world.
import {
  BlobReadKinds,
  PrSpanFailureKinds,
  readPrSpan,
  type PrSpanRefs,
  type PrSpanSource,
} from "brief-core/pr-span";
import { STORED_BODY_VERSION } from "brief-core/artifact";
import { DIFF_MODE_HEADER, DiffModes } from "contract";
import { RepoFileKinds } from "github";
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type PullRequestRow,
} from "persistence";
import { PrStates } from "types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  createKeyProvider,
} from "./fixtures";
import { testLogger } from "./logging";
import {
  UNUSED_INSTALLATION_DEPS,
  arrangeFakeGate,
  buildFakeAuthDeps,
} from "./reviewer-github";
import { registerSharedPglite, type SharedPglite } from "./shared-pglite";
import { seedSignIn } from "./sign-in";

const REPO_ID = 424242;
const REPO = { owner: "octo", repo: "hello" };
const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };

const OLD_BASE = "a".repeat(40);
const NEW_BASE = "b".repeat(40);
const OTHER_BASE = "e".repeat(40);
const HEAD_1 = "1".repeat(40);
const HEAD_2 = "2".repeat(40);
const CHECKPOINT = "c".repeat(40);
/** A merge base no head descends from: the push rewrote history. */
const FORK_POINT = "f".repeat(40);
const OTHER_REVIEWER_ID = 999n;
const PAST_FILE_BOUND = 301;
const FILE_PATH = "src/a.ts";
const FILE_LINES = 12;
const EDITED_LINE = 6;

interface ArrangedCompare {
  readonly base: string;
  readonly head: string;
  readonly diff?: string;
  readonly mergeBase?: string;
}

interface ArrangedFile {
  readonly ref: string;
  readonly path: string;
  readonly content: string;
}

/** What GitHub holds for one span read: compares by pair and blobs by ref. */
interface SpanWorld {
  readonly compares: readonly ArrangedCompare[];
  readonly files: readonly ArrangedFile[];
}

function makeFileText(edits: Readonly<Record<number, string>>): string {
  const lines = Array.from(
    { length: FILE_LINES },
    (_, index) => edits[index + 1] ?? `line ${index + 1}`,
  );
  return `${lines.join("\n")}\n`;
}

/** One file's PR diff: line 6 becomes `edited`, under the blob ids named. */
function makePrDiff(blobs: string, edited: string): string {
  return `diff --git a/${FILE_PATH} b/${FILE_PATH}
index ${blobs} 100644
--- a/${FILE_PATH}
+++ b/${FILE_PATH}
@@ -3,7 +3,7 @@
 line 3
 line 4
 line 5
-line 6
+${edited}
 line 7
 line 8
 line 9
`;
}

const FIRST_EDIT = "six at the first head";
const SECOND_EDIT = "six at the second head";
const FIRST_HEAD_TEXT = makeFileText({ [EDITED_LINE]: FIRST_EDIT });
const SECOND_HEAD_TEXT = makeFileText({ [EDITED_LINE]: SECOND_EDIT });

/**
 * A push that rewrote line 6 again on history the first head is not part
 * of, so the span is built from both PR diffs and both heads' blobs.
 */
function makeRewriteWorld(refs: PrSpanRefs, prevBlobs: string): SpanWorld {
  return {
    compares: [
      {
        base: refs.prevBase,
        head: refs.prevHead,
        diff: makePrDiff(prevBlobs, FIRST_EDIT),
      },
      {
        base: refs.newBase,
        head: refs.newHead,
        diff: makePrDiff("aaaaaaa..2222222", SECOND_EDIT),
      },
      { base: refs.prevHead, head: refs.newHead, mergeBase: FORK_POINT },
    ],
    files: [
      { ref: refs.prevHead, path: FILE_PATH, content: FIRST_HEAD_TEXT },
      { ref: refs.newHead, path: FILE_PATH, content: SECOND_HEAD_TEXT },
    ],
  };
}

function arrangeSpanWorld(fake: FakeGitHub, world: SpanWorld): void {
  for (const { base, head, ...compare } of world.compares) {
    fake.addCompare(REPO, { base, head }, compare);
  }
  for (const file of world.files) {
    const content = file.content;
    const blob = { kind: RepoFileKinds.FILE, content, blobSha: file.ref };
    fake.addRepoFile(
      REPO,
      { path: file.path, ref: file.ref },
      { ...blob, size: content.length },
    );
  }
}

/** The world as the worker's in-process read sees it. */
function buildWorldSource(world: SpanWorld): PrSpanSource {
  function findCompare(span: { base: string; head: string }) {
    return world.compares.find(
      (compare) => compare.base === span.base && compare.head === span.head,
    );
  }
  return {
    async fetchPrDiff(span) {
      const diff = findCompare(span)?.diff;
      if (diff === undefined) {
        return { ok: false, error: { kind: PrSpanFailureKinds.UNAVAILABLE } };
      }
      return { ok: true, value: diff };
    },
    async fetchBlob(blob) {
      const file = world.files.find(
        (entry) => entry.ref === blob.ref && entry.path === blob.path,
      );
      if (file === undefined) {
        return { ok: true, value: { kind: BlobReadKinds.ABSENT } };
      }
      const text = { kind: BlobReadKinds.TEXT, content: file.content };
      return { ok: true, value: text };
    },
    async fetchMergeBase(span) {
      return { ok: true, value: findCompare(span)?.mergeBase ?? span.base };
    },
  };
}

async function readInProcessSpan(
  world: SpanWorld,
  refs: PrSpanRefs,
): Promise<string> {
  const source = buildWorldSource(world);
  const read = await readPrSpan(source, refs, new AbortController().signal);
  if (!read.ok) {
    throw new Error(`in-process span read failed: ${read.error.kind}`);
  }
  return read.value.filteredDiff;
}

async function seedPullRequest(
  handle: AppDatabase,
  baseSha: string,
): Promise<PullRequestRow> {
  return createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
    baseSha,
  });
}

async function seedBrief(
  handle: AppDatabase,
  pr: PullRequestRow,
  pair: { base: string; head: string; headIndex: number },
): Promise<void> {
  await createArtifactStore(handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: pair.base,
    headSha: pair.head,
    headIndex: pair.headIndex,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    bodyVersion: STORED_BODY_VERSION,
    body: "{}",
    usedGroupIds: [],
  });
}

async function seedMarks(
  handle: AppDatabase,
  pr: PullRequestRow,
  refs: PrSpanRefs,
): Promise<void> {
  const marks = { baselineSha: refs.prevHead, headSha: refs.newHead };
  await createArtifactStore(handle, CTX).comparisonMarks.write({
    pullRequestId: pr.id,
    refs: { prevBase: refs.prevBase, newBase: refs.newBase },
    marks: { ...marks, files: [] },
  });
}

async function seedSkippedDelta(
  handle: AppDatabase,
  pr: PullRequestRow,
  pair: { base: string; head: string },
): Promise<void> {
  await createArtifactStore(handle, CTX).deltas.write({
    pullRequestId: pr.id,
    baselineSha: pair.base,
    headSha: pair.head,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    bodyVersion: STORED_BODY_VERSION,
    body: JSON.stringify({
      skipped: "span-too-large",
      artifactKind: "deltaSkipped",
    }),
  });
}

async function seedCheckpoint(
  handle: AppDatabase,
  pr: PullRequestRow,
  reviewerId: bigint,
): Promise<void> {
  await createTenantRepository(handle, CTX).checkpoints.upsertOnSubmit({
    pullRequestId: pr.id,
    reviewerId: brandReviewerId(reviewerId),
    lastSubmittedSha: CHECKPOINT,
    submittedAt: new Date(),
  });
}

/** A PR retargeted from OLD_BASE to NEW_BASE between its two briefed heads. */
async function seedRetarget(handle: AppDatabase): Promise<PullRequestRow> {
  const pr = await seedPullRequest(handle, NEW_BASE);
  await seedBrief(handle, pr, { base: OLD_BASE, head: HEAD_1, headIndex: 1 });
  await seedBrief(handle, pr, { base: NEW_BASE, head: HEAD_2, headIndex: 2 });
  return pr;
}

const RETARGET_REFS: PrSpanRefs = {
  prevBase: OLD_BASE,
  prevHead: HEAD_1,
  newBase: NEW_BASE,
  newHead: HEAD_2,
};

/** The PR diffs read, by each SHA's first character, in sorted order: one round reads both sides at once. */
function readComparedPairs(fake: FakeGitHub): string[] {
  const calls = fake.listCalls("fetchCheckedCompareDiff");
  const pairs = calls.map((call) => {
    const input = call.input as { base: string; head: string };
    return `${input.base.slice(0, 1)}...${input.head.slice(0, 1)}`;
  });
  return pairs.toSorted();
}

/** Holds every merge-base read until `release`, so concurrent reads overlap. */
function buildHeldAuthDeps(
  kp: KeyProvider,
  fake: FakeGitHub,
  release: Promise<void>,
): AuthDeps {
  return {
    ...buildFakeAuthDeps(kp, fake),
    bindReviewerGitHub(credential, options) {
      const github = fake.bindReviewerGitHub(credential, options);
      return {
        ...github,
        forRepo(repo) {
          const client = github.forRepo(repo);
          async function fetchMergeBase(
            span: Parameters<typeof client.fetchMergeBase>[0],
          ) {
            await release;
            return client.fetchMergeBase(span);
          }
          return { ...client, fetchMergeBase };
        },
      };
    },
  };
}

/** Every marks-row read fails as a dropped connection does. */
function failMarksReads(harness: SharedPglite): void {
  const database = harness.database;
  const query = database.query.bind(database);
  vi.spyOn(database, "query").mockImplementation((sql, ...rest) => {
    if (sql.includes('from "comparison_marks"')) {
      return Promise.reject(new Error("connection terminated"));
    }
    return query(sql, ...rest);
  });
}

describe("diff read of a marked span", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;
  let cookie: string;

  function buildApp(auth: AuthDeps): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth,
      ...UNUSED_INSTALLATION_DEPS,
    });
  }

  beforeEach(async () => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    arrangeFakeGate(fake, { repoId: REPO_ID });
    app = buildApp(buildFakeAuthDeps(kp, fake));
    cookie = (await seedSignIn(harness.handle, kp)).cookie;
  });

  async function readDiff(
    pair: { base: string; head: string },
    signal?: AbortSignal,
  ): Promise<Response> {
    const query = `base=${pair.base}&head=${pair.head}`;
    const path = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/diff?${query}`;
    const init: RequestInit = {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    };
    if (signal !== undefined) {
      init.signal = signal;
    }
    return app.request(path, init);
  }

  const SPAN_PAIR = { base: HEAD_1, head: HEAD_2 };

  it("serves a retarget's span on the bases its marks row stores", async () => {
    const pr = await seedRetarget(harness.handle);
    await seedMarks(harness.handle, pr, RETARGET_REFS);
    const world = makeRewriteWorld(RETARGET_REFS, "aaaaaaa..1111111");
    arrangeSpanWorld(fake, world);

    const res = await readDiff(SPAN_PAIR);

    expect(res.status).toBe(200);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
    const served = await res.text();
    expect(served).toContain(`+${SECOND_EDIT}`);
    expect(served).toBe(await readInProcessSpan(world, RETARGET_REFS));
    expect(readComparedPairs(fake)).toEqual(["a...1", "b...2"]);
  });

  it("serves a Checkpoint with no Brief on the PR base its row stores", async () => {
    const pr = await seedPullRequest(harness.handle, NEW_BASE);
    await seedBrief(harness.handle, pr, {
      base: NEW_BASE,
      head: HEAD_2,
      headIndex: 1,
    });
    const refs = { ...RETARGET_REFS, prevBase: NEW_BASE, prevHead: CHECKPOINT };
    await seedMarks(harness.handle, pr, refs);
    const world = makeRewriteWorld(refs, "aaaaaaa..1111111");
    arrangeSpanWorld(fake, world);

    const res = await readDiff({ base: CHECKPOINT, head: HEAD_2 });

    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
    expect(await res.text()).toBe(await readInProcessSpan(world, refs));
    expect(readComparedPairs(fake)).toEqual(["b...2", "b...c"]);
  });

  it("serves a same-head retarget's span as the in-process read does", async () => {
    const pr = await seedPullRequest(harness.handle, NEW_BASE);
    await seedBrief(harness.handle, pr, {
      base: OLD_BASE,
      head: HEAD_2,
      headIndex: 1,
    });
    await seedBrief(harness.handle, pr, {
      base: NEW_BASE,
      head: HEAD_2,
      headIndex: 2,
    });
    const refs = { ...RETARGET_REFS, prevHead: HEAD_2 };
    await seedMarks(harness.handle, pr, refs);
    const world: SpanWorld = {
      compares: [
        {
          base: OLD_BASE,
          head: HEAD_2,
          diff: makePrDiff("aaaaaaa..2222222", SECOND_EDIT),
        },
        {
          base: NEW_BASE,
          head: HEAD_2,
          diff: makePrDiff("bbbbbbb..2222222", SECOND_EDIT),
        },
      ],
      files: [{ ref: HEAD_2, path: FILE_PATH, content: SECOND_HEAD_TEXT }],
    };
    arrangeSpanWorld(fake, world);

    const res = await readDiff({ base: HEAD_2, head: HEAD_2 });

    expect(res.status).toBe(200);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
    expect(await res.text()).toBe(await readInProcessSpan(world, refs));
    expect(readComparedPairs(fake)).toEqual(["a...2", "b...2"]);
  });

  it("reads the rewritten refs after a marks row moves, then caches", async () => {
    const pr = await seedRetarget(harness.handle);
    await seedMarks(harness.handle, pr, RETARGET_REFS);
    arrangeSpanWorld(fake, makeRewriteWorld(RETARGET_REFS, "aaaaaaa..1111111"));
    const movedRefs = { ...RETARGET_REFS, newBase: OTHER_BASE };
    const movedWorld = makeRewriteWorld(movedRefs, "aaaaaaa..1111111");
    arrangeSpanWorld(fake, movedWorld);

    const before = await readDiff(SPAN_PAIR);
    await before.text();
    await seedMarks(harness.handle, pr, movedRefs);
    const after = await readDiff(SPAN_PAIR);
    const cached = await readDiff(SPAN_PAIR);

    expect(await after.text()).toBe(
      await readInProcessSpan(movedWorld, movedRefs),
    );
    expect(await cached.text()).toBe(
      await readInProcessSpan(movedWorld, movedRefs),
    );
    expect(readComparedPairs(fake)).toEqual([
      "a...1",
      "a...1",
      "b...2",
      "e...2",
    ]);
  });

  it("serves another reviewer's Checkpoint SHA with marks as a span", async () => {
    const pr = await seedPullRequest(harness.handle, NEW_BASE);
    await seedBrief(harness.handle, pr, {
      base: NEW_BASE,
      head: HEAD_2,
      headIndex: 1,
    });
    await seedCheckpoint(harness.handle, pr, OTHER_REVIEWER_ID);
    const refs = { ...RETARGET_REFS, prevBase: NEW_BASE, prevHead: CHECKPOINT };
    await seedMarks(harness.handle, pr, refs);
    arrangeSpanWorld(fake, makeRewriteWorld(refs, "aaaaaaa..1111111"));

    const res = await readDiff({ base: CHECKPOINT, head: HEAD_2 });

    expect(res.status).toBe(200);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
  });

  it("compares a head still generating, then reads its span once marked", async () => {
    const pr = await seedPullRequest(harness.handle, NEW_BASE);
    await seedBrief(harness.handle, pr, {
      base: NEW_BASE,
      head: HEAD_1,
      headIndex: 1,
    });
    const refs = { ...RETARGET_REFS, prevBase: NEW_BASE };
    const world = makeRewriteWorld(refs, "aaaaaaa..1111111");
    const threeDot = makePrDiff("1111111..2222222", SECOND_EDIT);
    arrangeSpanWorld(fake, {
      ...world,
      compares: [
        ...world.compares.slice(0, 2),
        { base: HEAD_1, head: HEAD_2, diff: threeDot, mergeBase: FORK_POINT },
      ],
    });

    const generating = await readDiff(SPAN_PAIR);
    const comparedText = await generating.text();
    await seedMarks(harness.handle, pr, refs);
    const marked = await readDiff(SPAN_PAIR);

    expect(generating.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.COMPARE);
    expect(comparedText).toBe(threeDot);
    expect(marked.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
    expect(await marked.text()).toBe(await readInProcessSpan(world, refs));
  });

  it("compares a pair whose head comes before its briefed base", async () => {
    const pr = await seedRetarget(harness.handle);
    await seedMarks(harness.handle, pr, RETARGET_REFS);
    const reversed = { base: HEAD_2, head: HEAD_1 };
    const threeDot = makePrDiff("2222222..1111111", FIRST_EDIT);
    fake.addCompare(REPO, reversed, { diff: threeDot });

    const res = await readDiff(reversed);

    expect(res.status).toBe(200);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.COMPARE);
    expect(await res.text()).toBe(threeDot);
    expect(fake.listCalls("fetchMergeBase")).toEqual([]);
  });

  it("compares a stacked PR whose base is one of its briefed heads", async () => {
    const pr = await seedPullRequest(harness.handle, HEAD_1);
    await seedBrief(harness.handle, pr, {
      base: OLD_BASE,
      head: HEAD_1,
      headIndex: 1,
    });
    await seedMarks(harness.handle, pr, { ...RETARGET_REFS, newBase: HEAD_1 });
    const wholePr = makePrDiff("1111111..2222222", SECOND_EDIT);
    fake.addCompare(REPO, SPAN_PAIR, { diff: wholePr });

    const res = await readDiff(SPAN_PAIR);

    expect(res.status).toBe(200);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.COMPARE);
    expect(await res.text()).toBe(wholePr);
    expect(fake.listCalls("fetchMergeBase")).toEqual([]);
  });

  it("answers a span past the file bound 413 before any blob read", async () => {
    const pr = await seedRetarget(harness.handle);
    await seedMarks(harness.handle, pr, RETARGET_REFS);
    const paths = Array.from(
      { length: PAST_FILE_BOUND },
      (_, index) => `src/f${index}.ts`,
    );
    function makeManyFileDiff(blobs: string): string {
      const patches = paths.map((path) =>
        makePrDiff(blobs, path).replaceAll(FILE_PATH, path),
      );
      return patches.join("");
    }
    arrangeSpanWorld(fake, {
      compares: [
        { base: OLD_BASE, head: HEAD_1, diff: makeManyFileDiff("a..1") },
        { base: NEW_BASE, head: HEAD_2, diff: makeManyFileDiff("a..2") },
      ],
      files: [],
    });

    const res = await readDiff(SPAN_PAIR);

    expect(res.status).toBe(413);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
    expect(await res.json()).toMatchObject({ code: "diff-too-large" });
    expect(fake.listCalls("fetchRepoFile")).toEqual([]);
  });

  it("answers a span the worker refused 413 with no GitHub read", async () => {
    const pr = await seedRetarget(harness.handle);
    await seedSkippedDelta(harness.handle, pr, SPAN_PAIR);

    const res = await readDiff(SPAN_PAIR);

    expect(res.status).toBe(413);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
    expect(fake.listCalls("fetchMergeBase")).toEqual([]);
    expect(fake.listCalls("fetchCheckedCompareDiff")).toEqual([]);
  });

  const deniedReads = [
    ["a 403 on a merge base", "fetchMergeBase", FakeFailures.FORBIDDEN, 404],
    ["a 401 on a blob", "fetchRepoFile", FakeFailures.UNAUTHORIZED, 401],
  ] as const;

  it.each(deniedReads)(
    "answers %s as denied, never a retryable 502",
    async (_label, operation, failure, status) => {
      const pr = await seedRetarget(harness.handle);
      await seedMarks(harness.handle, pr, RETARGET_REFS);
      arrangeSpanWorld(
        fake,
        makeRewriteWorld(RETARGET_REFS, "aaaaaaa..1111111"),
      );
      fake.failOn(operation, failure, CredentialKinds.REVIEWER);

      const res = await readDiff(SPAN_PAIR);

      expect(res.status).toBe(status);
      expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
    },
  );

  it("answers a previous head GitHub no longer holds 404", async () => {
    const pr = await seedRetarget(harness.handle);
    await seedMarks(harness.handle, pr, RETARGET_REFS);
    const world = makeRewriteWorld(RETARGET_REFS, "aaaaaaa..1111111");
    arrangeSpanWorld(fake, { ...world, compares: world.compares.slice(1) });

    const res = await readDiff(SPAN_PAIR);

    expect(res.status).toBe(404);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
    expect(await res.json()).toMatchObject({ code: "not-found" });
  });

  it("answers a 406 on a head's blob as too large", async () => {
    const pr = await seedRetarget(harness.handle);
    await seedMarks(harness.handle, pr, RETARGET_REFS);
    arrangeSpanWorld(fake, makeRewriteWorld(RETARGET_REFS, "aaaaaaa..1111111"));
    fake.failRepoFile(
      REPO,
      { path: FILE_PATH, ref: HEAD_1 },
      FakeFailures.NOT_ACCEPTABLE,
    );

    const res = await readDiff(SPAN_PAIR);

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "diff-too-large" });
  });

  it("answers a 406 on a PR diff as too large", async () => {
    const pr = await seedRetarget(harness.handle);
    await seedMarks(harness.handle, pr, RETARGET_REFS);
    arrangeSpanWorld(fake, makeRewriteWorld(RETARGET_REFS, "aaaaaaa..1111111"));
    fake.failOn("fetchCheckedCompareDiff", FakeFailures.NOT_ACCEPTABLE);

    const res = await readDiff(SPAN_PAIR);

    expect(res.status).toBe(413);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.REVISION_SPAN);
  });

  it("shares one read between two requests when one disconnects", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    app = buildApp(buildHeldAuthDeps(kp, fake, held));
    const pr = await seedRetarget(harness.handle);
    await seedMarks(harness.handle, pr, RETARGET_REFS);
    const world = makeRewriteWorld(RETARGET_REFS, "aaaaaaa..1111111");
    arrangeSpanWorld(fake, world);
    const disconnect = new AbortController();

    const leaving = readDiff(SPAN_PAIR, disconnect.signal);
    const staying = readDiff(SPAN_PAIR);
    await vi.waitFor(() => {
      expect(fake.listCalls("fetchCheckedCompareDiff")).toHaveLength(1);
    });
    disconnect.abort();
    release();
    const served = await staying;
    await leaving.catch(() => undefined);

    expect(served.status).toBe(200);
    expect(await served.text()).toBe(
      await readInProcessSpan(world, RETARGET_REFS),
    );
    expect(fake.listCalls("fetchMergeBase")).toHaveLength(3);
  });

  it("fails the read when the marks row cannot be read", async () => {
    await seedRetarget(harness.handle);
    failMarksReads(harness);

    const res = await readDiff(SPAN_PAIR);

    expect(res.status).toBe(500);
    expect(fake.listCalls("fetchCheckedCompareDiff")).toEqual([]);
  });

  it("names the compare on an error answer of a whole-PR read", async () => {
    await seedRetarget(harness.handle);
    fake.failOn("fetchCheckedCompareDiff", FakeFailures.NOT_ACCEPTABLE);

    const res = await readDiff({ base: NEW_BASE, head: HEAD_2 });

    expect(res.status).toBe(413);
    expect(res.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.COMPARE);
  });
});
