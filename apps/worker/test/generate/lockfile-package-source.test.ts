import { describe, expect, it } from "vitest";
import { FakeFailures } from "github/testing";
import { TransientJobError } from "../../src/task/failure";
import {
  createArtifactStore,
  createTenantRepository,
  type PullRequestRowId,
} from "persistence";
import {
  arrangeNewHeadPrDiff,
  arrangeRevisionSpan,
  BASE,
  buildRepoFile,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  makeGitHub,
  makeHeadPrDiff,
  makePullRequestInfo,
  makeReviewerId,
  makeTask,
  PR_REF,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";

setUpHarness();

const LOCKFILE = "pnpm-lock.yaml";
const CHANGES_PACKAGE_SOURCE = "changes-package-source";

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
diff --git a/${LOCKFILE} b/${LOCKFILE}
--- a/${LOCKFILE}
+++ b/${LOCKFILE}
@@ -1,2 +1,2 @@
 lockfileVersion: '9.0'
-old
+new
`;

const ADDED_DIFF = `diff --git a/${LOCKFILE} b/${LOCKFILE}
new file mode 100644
--- /dev/null
+++ b/${LOCKFILE}
@@ -0,0 +1 @@
+lockfileVersion: '9.0'
`;

function makePnpmLockfile(key: string, resolution: string): string {
  return [
    "lockfileVersion: '9.0'",
    "packages:",
    `  ${key}:`,
    `    resolution: ${resolution}`,
    "snapshots:",
    `  ${key}: {}`,
    "",
  ].join("\n");
}

const REGISTRY = "{integrity: sha512-a}";

function makePnpmLockfileOf(packages: Record<string, string>): string {
  const keys = Object.keys(packages);
  return [
    "lockfileVersion: '9.0'",
    "packages:",
    ...keys.map((key) => `  ${key}:\n    resolution: ${packages[key]}`),
    "snapshots:",
    ...keys.map((key) => `  ${key}: {}`),
    "",
  ].join("\n");
}
/** The PR's own lockfile change at the second head: foo@1.0.0 to foo@1.1.0. */
const FOO_BUMP_DIFF = `diff --git a/${LOCKFILE} b/${LOCKFILE}
--- a/${LOCKFILE}
+++ b/${LOCKFILE}
@@ -1,6 +1,6 @@
 lockfileVersion: '9.0'
 packages:
-  foo@1.0.0:
+  foo@1.1.0:
     resolution: ${REGISTRY}
 snapshots:
-  foo@1.0.0: {}
+  foo@1.1.0: {}
`;
/** One more lockfile than a span reads. */
const LOCKFILES_PAST_CAP = 21;
/** Twenty lockfile children fork one after another. */
const PAST_CAP_TIMEOUT_MS = 60_000;
const MERGE_BASE = "d".repeat(40);
/** The first head's merge base before the rebase onto OTHER_BASE. */
const OLD_MERGE_BASE = "9".repeat(40);
const OTHER_BASE = "e".repeat(40);
/** Long enough for the child to fill its heap cap and be killed. */
const HEAP_EXHAUSTION_TIMEOUT_MS = 60_000;
const FLOW_ITEMS = 64;
/** Just under the byte cap. */
const HOSTILE_LOCKFILE_BYTES = 8_000_000;

/**
 * A lockfile inside every limit the pre-parse check holds (one flow level,
 * 64 items a line, lines under the cap) whose four million nodes still
 * exhaust the child's heap.
 */
function makeHeapExhaustingLockfile(): string {
  const items = Array.from({ length: FLOW_ITEMS }, () => "a").join(",");
  const lines = ["lockfileVersion: '9.0'", "packages:"];
  let bytes = 0;
  for (let index = 0; bytes < HOSTILE_LOCKFILE_BYTES; index += 1) {
    const line = `  k${index}: [${items}]`;
    lines.push(line);
    bytes += line.length + 1;
  }
  return lines.join("\n");
}
const MIRROR = "{tarball: https://mirror.example/foo.tgz}";
const NPM_MIRROR = "https://mirror.example/foo/-/foo-1.0.0.tgz";

function makeNpmLockfile(resolved: string): string {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: { "": {}, "node_modules/foo": { version: "1.0.0", resolved } },
  });
}

function makeRenameDiff(previousPath: string, path: string): string {
  return [
    `diff --git a/${previousPath} b/${path}`,
    "similarity index 90%",
    `rename from ${previousPath}`,
    `rename to ${path}`,
    `--- a/${previousPath}`,
    `+++ b/${path}`,
    "@@ -1,2 +1,2 @@",
    " lockfileVersion: '9.0'",
    "-old",
    "+new",
    "",
  ].join("\n");
}

/** The delta's one chunk is the lockfile's, so its risk surface is the rule's answer. */
function arrangeLockfileDelta(generator: ReturnType<typeof stubGenerator>) {
  const brief = generator.outputs["brief"] as { changeGroups: object[] };
  generator.outputs["delta"] = {
    summary: "bumps foo",
    commentsAddressed: "",
    changedGroups: brief.changeGroups,
    chunks: [
      {
        id: "c1",
        changeGroupId: "g1",
        file: LOCKFILE,
        concern: "generated",
        role: "supporting",
        addedRanges: [{ start: 2, end: 2 }],
        removedRanges: [{ start: 2, end: 2 }],
        riskSurface: [],
        summary: "bumps foo",
        addressesComments: [],
      },
    ],
    wholePrImpact: "",
  };
}

function arrangeLockfile(before: string, after: string) {
  const github = makeGitHub(HEAD_1);
  github.addPullRequest(PR_REF, {
    info: makePullRequestInfo(HEAD_1),
    files: [
      { path: "a.ts", additions: 1, deletions: 0 },
      { path: LOCKFILE, additions: 1, deletions: 1 },
    ],
    diff: DIFF,
  });
  github.addRepoFile(
    REPO,
    { path: LOCKFILE, ref: BASE },
    buildRepoFile(before, "sha-base"),
  );
  github.addRepoFile(
    REPO,
    { path: LOCKFILE, ref: HEAD_1 },
    buildRepoFile(after, "sha-head"),
  );
  return github;
}

async function readLockfileRisks(prId: PullRequestRowId): Promise<unknown> {
  return readLockfileRisksAt(prId, LOCKFILE);
}

async function readLockfileRisksAt(
  prId: PullRequestRowId,
  path: string | undefined,
): Promise<unknown> {
  const stored = await createArtifactStore(harness.handle, ctx).briefs.get(
    prId,
    BASE,
    HEAD_1,
  );
  const body = JSON.parse(stored?.body ?? "{}") as {
    unattributed?: { file: string; riskSurface?: string[] }[];
  };
  return body.unattributed?.find((file) => file.file === path)?.riskSurface;
}

describe("generate task, changes-package-source from lockfile contents", () => {
  it("reads the lockfile at base and head and flags a moved source", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = arrangeLockfile(
      makePnpmLockfile("foo@1.0.0", REGISTRY),
      makePnpmLockfile("foo@1.0.0", MIRROR),
    );

    await makeTask({ github })(payload);

    const reads = github
      .listCalls("fetchRepoFile")
      .map((call) => call.input as { path: string; ref?: string })
      .filter((input) => input.path === LOCKFILE)
      .map((input) => input.ref);
    expect(reads).toHaveLength(2);
    expect(reads).toEqual(expect.arrayContaining([BASE, HEAD_1]));
    expect(await readLockfileRisks(pr.id)).toEqual([CHANGES_PACKAGE_SOURCE]);
  });

  it("flags a lockfile the diff names but no commit holds", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.addPullRequest(PR_REF, {
      info: makePullRequestInfo(HEAD_1),
      files: [{ path: LOCKFILE, additions: 1, deletions: 1 }],
      diff: DIFF,
    });

    await makeTask({ github })(payload);

    expect(await readLockfileRisks(pr.id)).toEqual([CHANGES_PACKAGE_SOURCE]);
  });

  it.each([
    ["an off-registry entry", MIRROR, [CHANGES_PACKAGE_SOURCE]],
    ["only registry entries", REGISTRY, undefined],
  ])(
    "reads an added lockfile holding %s",
    async (_label, resolution, risks) => {
      const { pr, payload } = await trigger(HEAD_1);
      const github = makeGitHub(HEAD_1);
      github.addPullRequest(PR_REF, {
        info: makePullRequestInfo(HEAD_1),
        files: [{ path: LOCKFILE, additions: 1, deletions: 0 }],
        diff: ADDED_DIFF,
      });
      github.addRepoFile(
        REPO,
        { path: LOCKFILE, ref: HEAD_1 },
        buildRepoFile(makePnpmLockfile("foo@1.0.0", resolution), "sha-head"),
      );

      await makeTask({ github })(payload);

      expect(await readLockfileRisks(pr.id)).toEqual(risks);
    },
  );

  it.each([
    ["a server error", FakeFailures.SERVER_ERROR],
    ["a rate limit", FakeFailures.RATE_LIMITED],
  ])("retries on %s reading the base side", async (_label, failure) => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = arrangeLockfile(
      makePnpmLockfile("foo@1.0.0", REGISTRY),
      makePnpmLockfile("foo@1.0.0", REGISTRY),
    );
    github.failRepoFile(REPO, { path: LOCKFILE, ref: BASE }, failure);

    await expect(makeTask({ github })(payload)).rejects.toThrow(
      TransientJobError,
    );

    const stored = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(stored).toBeUndefined();
  });

  it.each([
    ["a symlink", FakeFailures.NOT_A_BLOB],
    ["bytes that are not UTF-8", FakeFailures.NOT_TEXT],
  ])("flags a head lockfile GitHub serves as %s", async (_label, failure) => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = arrangeLockfile(
      makePnpmLockfile("foo@1.0.0", REGISTRY),
      makePnpmLockfile("foo@1.0.0", REGISTRY),
    );
    github.failRepoFile(REPO, { path: LOCKFILE, ref: HEAD_1 }, failure);

    await makeTask({ github })(payload);

    expect(await readLockfileRisks(pr.id)).toEqual([CHANGES_PACKAGE_SOURCE]);
  });

  it("retries on a transient failure reading the merge base", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = arrangeLockfile(
      makePnpmLockfile("foo@1.0.0", REGISTRY),
      makePnpmLockfile("foo@1.0.0", REGISTRY),
    );
    github.failOn("fetchMergeBase", FakeFailures.SERVER_ERROR);

    await expect(makeTask({ github })(payload)).rejects.toThrow(
      TransientJobError,
    );
  });

  it("flags a lockfile whose merge base is refused for good", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = arrangeLockfile(
      makePnpmLockfile("foo@1.0.0", REGISTRY),
      makePnpmLockfile("foo@1.0.0", REGISTRY),
    );
    github.failOn("fetchMergeBase", FakeFailures.NOT_FOUND);

    await makeTask({ github })(payload);

    expect(await readLockfileRisks(pr.id)).toEqual([CHANGES_PACKAGE_SOURCE]);
  });

  it(
    "flags a lockfile whose summary child runs out of heap",
    async () => {
      const { pr, payload } = await trigger(HEAD_1);
      const github = arrangeLockfile(
        makePnpmLockfile("foo@1.0.0", REGISTRY),
        makeHeapExhaustingLockfile(),
      );
      const { logger, readLines } = captureLogger();

      await makeTask({ github, log: logger })(payload);

      const childFailure = readLines().find((line) =>
        String(line["msg"]).includes("lockfile summary child failed"),
      );
      expect(childFailure?.["reason"]).toBe("crashed");
      expect(await readLockfileRisks(pr.id)).toEqual([CHANGES_PACKAGE_SOURCE]);
    },
    HEAP_EXHAUSTION_TIMEOUT_MS,
  );

  it("reads the base side at the merge base the diff is taken from", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = arrangeLockfile(
      makePnpmLockfile("foo@1.0.0", MIRROR),
      makePnpmLockfile("foo@1.0.0", REGISTRY),
    );
    github.addCompare(
      REPO,
      { base: BASE, head: HEAD_1 },
      { mergeBase: MERGE_BASE },
    );
    github.addRepoFile(
      REPO,
      { path: LOCKFILE, ref: MERGE_BASE },
      buildRepoFile(makePnpmLockfile("foo@1.0.0", REGISTRY), "sha-merge-base"),
    );

    await makeTask({ github })(payload);

    const reads = github
      .listCalls("fetchRepoFile")
      .map((call) => call.input as { path: string; ref?: string })
      .filter((input) => input.path === LOCKFILE)
      .map((input) => input.ref);
    expect(reads).toEqual(expect.arrayContaining([MERGE_BASE, HEAD_1]));
    expect(reads).not.toContain(BASE);
    expect(await readLockfileRisks(pr.id)).toBeUndefined();
  });

  it("leaves a version bump on the same host unflagged", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = arrangeLockfile(
      makePnpmLockfile("foo@1.0.0", REGISTRY),
      makePnpmLockfile("foo@1.1.0", REGISTRY),
    );

    await makeTask({ github })(payload);

    expect(await readLockfileRisks(pr.id)).toBeUndefined();
  });

  it("reads a delta span's lockfile at its baseline, not its merge base", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ generator, github });
    await task(first.payload);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: HEAD_1,
      submittedAt: new Date(),
    });
    arrangeRevisionSpan(github, FOO_BUMP_DIFF);
    const span = { base: HEAD_1, head: HEAD_2 };
    github.addCompare(REPO, span, {
      diff: DIFF,
      files: { files: [], complete: false },
      mergeBase: MERGE_BASE,
    });
    for (const ref of [MERGE_BASE, HEAD_1]) {
      github.addRepoFile(
        REPO,
        { path: LOCKFILE, ref },
        buildRepoFile(makePnpmLockfile("foo@1.0.0", REGISTRY), "sha-base"),
      );
    }
    github.addRepoFile(
      REPO,
      { path: LOCKFILE, ref: HEAD_2 },
      buildRepoFile(makePnpmLockfile("foo@1.1.0", REGISTRY), "sha-head"),
    );
    const brief = generator.outputs["brief"] as { changeGroups: object[] };
    generator.outputs["delta"] = {
      summary: "bumps foo",
      commentsAddressed: "",
      changedGroups: brief.changeGroups,
      chunks: [
        {
          id: "c1",
          changeGroupId: "g1",
          file: LOCKFILE,
          concern: "generated",
          role: "supporting",
          addedRanges: [{ start: 2, end: 2 }],
          removedRanges: [{ start: 2, end: 2 }],
          riskSurface: [],
          summary: "bumps foo",
          addressesComments: [],
        },
      ],
      wholePrImpact: "",
    };

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const reads = github
      .listCalls("fetchRepoFile")
      .map((call) => call.input as { path: string; ref?: string })
      .filter((input) => input.path === LOCKFILE)
      .map((input) => input.ref);
    const row = await createArtifactStore(harness.handle, ctx).deltas.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    const body = JSON.parse(row?.body ?? "{}") as {
      chunks?: { file: string; riskSurface: string[] }[];
    };
    expect(reads).not.toContain(MERGE_BASE);
    expect(reads.filter((ref) => ref !== HEAD_1)).toEqual([HEAD_2, HEAD_2]);
    expect(body.chunks?.map((chunk) => chunk.riskSurface)).toEqual([[]]);
  });

  it("leaves a rebase's base-only mirror move out of a delta span", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    github.addCompare(
      REPO,
      { base: BASE, head: HEAD_1 },
      { diff: makeHeadPrDiff(HEAD_1), mergeBase: OLD_MERGE_BASE },
    );
    const task = makeTask({ generator, github });
    await task(first.payload);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: HEAD_1,
      submittedAt: new Date(),
    });
    const newPrDiff = `${makeHeadPrDiff(HEAD_1)}${FOO_BUMP_DIFF}`;
    arrangeNewHeadPrDiff(github, newPrDiff, OTHER_BASE);
    github.addCompare(
      REPO,
      { base: OTHER_BASE, head: HEAD_2 },
      { diff: newPrDiff, mergeBase: MERGE_BASE },
    );
    const own = { "bar@1.0.0": REGISTRY };
    const lockfiles = {
      [OLD_MERGE_BASE]: makePnpmLockfileOf({ "foo@1.0.0": REGISTRY }),
      [HEAD_1]: makePnpmLockfileOf({ "foo@1.0.0": REGISTRY, ...own }),
      [MERGE_BASE]: makePnpmLockfileOf({ "foo@2.0.0": MIRROR }),
      [HEAD_2]: makePnpmLockfileOf({ "foo@2.0.0": MIRROR, ...own }),
    };
    for (const [ref, text] of Object.entries(lockfiles)) {
      github.addRepoFile(
        REPO,
        { path: LOCKFILE, ref },
        buildRepoFile(text, `sha-${ref.slice(0, 1)}`),
      );
    }
    arrangeLockfileDelta(generator);

    github.updatePullRequest(PR_REF, { headSha: HEAD_2, baseSha: OTHER_BASE });
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const row = await createArtifactStore(harness.handle, ctx).deltas.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    const body = JSON.parse(row?.body ?? "{}") as {
      chunks?: { file: string; riskSurface: string[] }[];
    };
    expect(body.chunks?.map((chunk) => chunk.riskSurface)).toEqual([[]]);
  });

  it("reads a lockfile renamed in its folder by its previous path", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const previousPath = "app/npm-shrinkwrap.json";
    const path = "app/package-lock.json";
    const lockfile = makeNpmLockfile(NPM_MIRROR);
    const github = makeGitHub(HEAD_1);
    github.addPullRequest(PR_REF, {
      info: makePullRequestInfo(HEAD_1),
      files: [{ path, additions: 1, deletions: 1 }],
      diff: makeRenameDiff(previousPath, path),
    });
    github.addRepoFile(
      REPO,
      { path: previousPath, ref: BASE },
      buildRepoFile(lockfile, "sha-base"),
    );
    github.addRepoFile(
      REPO,
      { path, ref: HEAD_1 },
      buildRepoFile(lockfile, "sha-head"),
    );

    await makeTask({ github })(payload);

    const reads = github
      .listCalls("fetchRepoFile")
      .map((call) => call.input as { path: string; ref?: string })
      .filter((input) => input.path.startsWith("app/"));
    expect(reads).toEqual([
      expect.objectContaining({ path: previousPath, ref: BASE }),
      expect.objectContaining({ path, ref: HEAD_1 }),
    ]);
    expect(await readLockfileRisksAt(pr.id, path)).toBeUndefined();
  });

  it("reads a lockfile moved from another folder as a new lockfile", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const previousPath = `examples/x/${LOCKFILE}`;
    const lockfile = makePnpmLockfile("foo@1.0.0", MIRROR);
    const github = makeGitHub(HEAD_1);
    github.addPullRequest(PR_REF, {
      info: makePullRequestInfo(HEAD_1),
      files: [{ path: LOCKFILE, additions: 1, deletions: 1 }],
      diff: makeRenameDiff(previousPath, LOCKFILE),
    });
    github.addRepoFile(
      REPO,
      { path: previousPath, ref: BASE },
      buildRepoFile(lockfile, "sha-base"),
    );
    github.addRepoFile(
      REPO,
      { path: LOCKFILE, ref: HEAD_1 },
      buildRepoFile(lockfile, "sha-head"),
    );

    await makeTask({ github })(payload);

    const reads = github
      .listCalls("fetchRepoFile")
      .map((call) => call.input as { path: string; ref?: string })
      .filter((input) => input.path.endsWith(LOCKFILE));
    expect(github.listCalls("fetchMergeBase")).toEqual([]);
    expect(reads).toEqual([
      expect.objectContaining({ path: LOCKFILE, ref: HEAD_1 }),
    ]);
    expect(await readLockfileRisks(pr.id)).toEqual([CHANGES_PACKAGE_SOURCE]);
  });

  it("reads a rename into a lockfile name as a new lockfile", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const previousPath = `${LOCKFILE}.orig`;
    const github = makeGitHub(HEAD_1);
    github.addPullRequest(PR_REF, {
      info: makePullRequestInfo(HEAD_1),
      files: [{ path: LOCKFILE, additions: 1, deletions: 1 }],
      diff: [
        `diff --git a/${previousPath} b/${LOCKFILE}`,
        "similarity index 90%",
        `rename from ${previousPath}`,
        `rename to ${LOCKFILE}`,
        `--- a/${previousPath}`,
        `+++ b/${LOCKFILE}`,
        "@@ -1,2 +1,2 @@",
        " lockfileVersion: '9.0'",
        "-old",
        "+new",
        "",
      ].join("\n"),
    });
    github.addRepoFile(
      REPO,
      { path: previousPath, ref: BASE },
      buildRepoFile(makePnpmLockfile("foo@1.0.0", MIRROR), "sha-base"),
    );
    github.addRepoFile(
      REPO,
      { path: LOCKFILE, ref: HEAD_1 },
      buildRepoFile(makePnpmLockfile("foo@1.0.0", MIRROR), "sha-head"),
    );

    await makeTask({ github })(payload);

    const reads = github
      .listCalls("fetchRepoFile")
      .map((call) => call.input as { path: string; ref?: string })
      .filter((input) => input.path.startsWith(LOCKFILE));
    expect(reads).toEqual([
      expect.objectContaining({ path: LOCKFILE, ref: HEAD_1 }),
    ]);
    expect(await readLockfileRisks(pr.id)).toEqual([CHANGES_PACKAGE_SOURCE]);
  });

  it(
    "flags a lockfile past the read cap without reading it",
    async () => {
      const { pr, payload } = await trigger(HEAD_1);
      const paths = Array.from(
        { length: LOCKFILES_PAST_CAP },
        (_unused, index) => `pkg${index}/${LOCKFILE}`,
      );
      const diff = paths
        .map((path) =>
          [
            `diff --git a/${path} b/${path}`,
            `--- a/${path}`,
            `+++ b/${path}`,
            "@@ -1,2 +1,2 @@",
            " lockfileVersion: '9.0'",
            "-old",
            "+new",
            "",
          ].join("\n"),
        )
        .join("");
      const github = makeGitHub(HEAD_1);
      github.addPullRequest(PR_REF, {
        info: makePullRequestInfo(HEAD_1),
        files: paths.map((path) => ({ path, additions: 1, deletions: 1 })),
        diff,
      });
      for (const path of paths) {
        for (const ref of [BASE, HEAD_1]) {
          github.addRepoFile(
            REPO,
            { path, ref },
            buildRepoFile(
              makePnpmLockfile("foo@1.0.0", REGISTRY),
              `sha-${ref}`,
            ),
          );
        }
      }
      const pastCap = paths.at(-1);

      await makeTask({ github })(payload);

      const readPaths = github
        .listCalls("fetchRepoFile")
        .map((call) => (call.input as { path: string }).path);
      expect(readPaths).not.toContain(pastCap);
      expect(await readLockfileRisksAt(pr.id, pastCap)).toEqual([
        CHANGES_PACKAGE_SOURCE,
      ]);
      expect(await readLockfileRisksAt(pr.id, paths[0])).toBeUndefined();
    },
    PAST_CAP_TIMEOUT_MS,
  );
});
