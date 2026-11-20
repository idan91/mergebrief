import type { fork } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLockfileSummaries } from "../../src/task/generate/logic/lockfile-summaries";
import { LockfileSpanKinds } from "../../src/task/generate/logic/lockfile-summaries/types";
import { BASE, buildRepoFile, captureLogger, HEAD_1, HEAD_2 } from "./helpers";

const childForks = vi.hoisted(() => ({ count: 0 }));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<{ fork: typeof fork }>();
  return {
    ...original,
    fork: (...args: Parameters<typeof original.fork>) => {
      childForks.count += 1;
      return original.fork(...args);
    },
  };
});

const LOCKFILE = "pnpm-lock.yaml";
const MERGE_BASE = "d".repeat(40);
/** Past the 60 s every lockfile child of one span shares. */
const PAST_SPAN_BUDGET_MS = 61_000;
const CHILD_TIMEOUT_MS = 30_000;

const DIFF = `diff --git a/${LOCKFILE} b/${LOCKFILE}
--- a/${LOCKFILE}
+++ b/${LOCKFILE}
@@ -1,2 +1,2 @@
 lockfileVersion: '9.0'
-old
+new
`;

const LOCKFILE_TEXT = [
  "lockfileVersion: '9.0'",
  "packages:",
  "  foo@1.0.0:",
  "    resolution: {integrity: sha512-a}",
  "snapshots:",
  "  foo@1.0.0: {}",
  "",
].join("\n");

/** A source whose every read spends `spentMs` of the span budget. */
function stubLockfileSource(spentMs: number) {
  return {
    fetchMergeBase: async () => ({ ok: true as const, value: MERGE_BASE }),
    fetchRepoFileAt: async () => {
      vi.setSystemTime(Date.now() + spentMs);
      return { ok: true as const, value: buildRepoFile(LOCKFILE_TEXT, "sha") };
    },
  };
}

async function readSummaries(spentMs: number) {
  const { logger, readLines } = captureLogger();
  const summaries = await readLockfileSummaries(
    stubLockfileSource(spentMs),
    DIFF,
    { kind: LockfileSpanKinds.PULL_REQUEST, base: BASE, head: HEAD_1 },
    logger,
    [],
  );
  const failure = readLines().find((line) =>
    String(line["msg"]).includes("lockfile summary child failed"),
  );
  return { summary: summaries.get(LOCKFILE), reason: failure?.["reason"] };
}

describe("readLockfileSummaries span budget", () => {
  beforeEach(() => {
    childForks.count = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    "summarizes a lockfile in a child within the budget",
    async () => {
      vi.useFakeTimers({ toFake: ["Date"] });

      const { summary } = await readSummaries(0);

      expect(childForks.count).toBe(1);
      expect(summary).toMatchObject({ format: "pnpm", changes: {} });
    },
    CHILD_TIMEOUT_MS,
  );

  it("reads a lockfile past the budget as unparseable with no child", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });

    const { summary, reason } = await readSummaries(PAST_SPAN_BUDGET_MS);

    expect(childForks.count).toBe(0);
    expect(reason).toBe("timed-out");
    expect(summary).toEqual({ format: "pnpm", unread: "unparseable" });
  });
});

const OTHER_BASE = "e".repeat(40);
const OLD_MERGE_BASE = "9".repeat(40);
const REGISTRY = "{integrity: sha512-a}";
const MIRROR = "{tarball: https://mirror.example/x.tgz}";
const EVIL = "{tarball: https://evil.example/foo-1.0.0.tgz}";

function makePnpmLockfile(packages: Record<string, string>): string {
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

/** What a stub refuses for good: merge bases by `base...head` pair, file reads by ref. */
interface StubRefusals {
  readonly mergeBases?: readonly string[];
  readonly refs?: readonly string[];
}

/** A source holding `files` by ref, whose merge base of each base and head pair is `mergeBases`' entry. */
function stubSpanSource(
  files: Record<string, Record<string, string>>,
  mergeBases: Record<string, string>,
  refusals: StubRefusals = {},
) {
  const refs: string[] = [];
  const source = {
    fetchMergeBase: async (base: string, head: string) => {
      const pair = `${base}...${head}`;
      return refusals.mergeBases?.includes(pair) === true
        ? {
            ok: false as const,
            error: { code: "not-found" as const, message: "no merge base" },
          }
        : { ok: true as const, value: mergeBases[pair] ?? MERGE_BASE };
    },
    fetchRepoFileAt: async (_path: string, ref: string) => {
      refs.push(ref);
      if (refusals.refs?.includes(ref) === true) {
        return {
          ok: false as const,
          error: { code: "not-a-blob" as const, message: "not a file" },
        };
      }
      const packages = files[ref];
      return packages === undefined
        ? {
            ok: false as const,
            error: { code: "not-found" as const, message: "no file" },
          }
        : {
            ok: true as const,
            value: buildRepoFile(makePnpmLockfile(packages), "sha"),
          };
    },
  };
  return { source, refs };
}

async function readRevisionSummary(
  source: ReturnType<typeof stubSpanSource>["source"],
) {
  const summaries = await readLockfileSummaries(
    source,
    DIFF,
    {
      kind: LockfileSpanKinds.REVISION,
      base: HEAD_1,
      head: HEAD_2,
      refs: { prevBase: BASE, newBase: OTHER_BASE },
    },
    captureLogger().logger,
    [],
  );
  return summaries.get(LOCKFILE);
}

const NO_CHANGES = { added: [], removed: [], updated: [], sourceChanged: [] };
const REBASED_MERGE_BASES = {
  [`${BASE}...${HEAD_1}`]: OLD_MERGE_BASE,
  [`${OTHER_BASE}...${HEAD_2}`]: MERGE_BASE,
};

describe("readLockfileSummaries base side", () => {
  it(
    "leaves out a package the base moved between the heads' merge bases",
    async () => {
      const { source } = stubSpanSource(
        {
          [OLD_MERGE_BASE]: { "foo@1.0.0": REGISTRY },
          [HEAD_1]: { "foo@1.0.0": REGISTRY, "bar@1.0.0": REGISTRY },
          [MERGE_BASE]: { "foo@2.0.0": MIRROR },
          [HEAD_2]: { "foo@2.0.0": MIRROR, "bar@1.0.0": REGISTRY },
        },
        REBASED_MERGE_BASES,
      );

      const summary = await readRevisionSummary(source);

      expect(summary).toMatchObject({ changes: NO_CHANGES });
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "keeps the PR's own move to a mirror over a rebase",
    async () => {
      const { source } = stubSpanSource(
        {
          [OLD_MERGE_BASE]: { "foo@1.0.0": REGISTRY },
          [HEAD_1]: { "foo@1.0.0": REGISTRY, "bar@1.0.0": REGISTRY },
          [MERGE_BASE]: { "foo@2.0.0": MIRROR },
          [HEAD_2]: { "foo@2.0.0": MIRROR, "bar@1.0.0": MIRROR },
        },
        REBASED_MERGE_BASES,
      );

      const summary = await readRevisionSummary(source);

      expect(summary).toMatchObject({
        changes: { sourceChanged: [expect.objectContaining({ name: "bar" })] },
      });
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "reads a push on one merge base from the two heads alone",
    async () => {
      const { source, refs } = stubSpanSource(
        {
          [HEAD_1]: { "foo@1.0.0": REGISTRY },
          [HEAD_2]: { "foo@1.1.0": REGISTRY },
        },
        {},
      );

      const summary = await readRevisionSummary(source);

      expect(refs.toSorted()).toEqual([HEAD_1, HEAD_2].toSorted());
      expect(summary).toMatchObject({
        changes: { updated: [expect.objectContaining({ name: "foo" })] },
      });
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "leaves out a lockfile absent at a merge base as no entries there",
    async () => {
      const { source } = stubSpanSource(
        {
          [HEAD_1]: { "bar@1.0.0": REGISTRY },
          [MERGE_BASE]: { "baz@1.0.0": MIRROR },
          [HEAD_2]: { "baz@1.0.0": MIRROR, "bar@1.0.0": REGISTRY },
        },
        REBASED_MERGE_BASES,
      );

      const summary = await readRevisionSummary(source);

      expect(summary).toMatchObject({ changes: NO_CHANGES });
    },
    CHILD_TIMEOUT_MS,
  );
});

/** The base moved foo back to its registry; the PR kept foo on its own host. */
const KEPT_OFF_REGISTRY = {
  [OLD_MERGE_BASE]: { "foo@1.0.0": EVIL },
  [HEAD_1]: { "foo@1.0.0": EVIL, "bar@1.0.0": REGISTRY },
  [MERGE_BASE]: { "foo@1.0.0": REGISTRY },
  [HEAD_2]: {
    "foo@1.0.0": EVIL,
    "bar@1.0.0": REGISTRY,
    "baz@1.0.0": REGISTRY,
  },
};

describe("readLockfileSummaries unread merge base", () => {
  it(
    "fires on a source the PR keeps after the base moved off it",
    async () => {
      const { source } = stubSpanSource(KEPT_OFF_REGISTRY, REBASED_MERGE_BASES);

      const summary = await readRevisionSummary(source);

      expect(summary).toMatchObject({
        changes: { sourceChanged: [expect.objectContaining({ name: "foo" })] },
      });
    },
    CHILD_TIMEOUT_MS,
  );

  it("reads the lockfile unread when a merge base is refused for good", async () => {
    const { source, refs } = stubSpanSource(
      KEPT_OFF_REGISTRY,
      REBASED_MERGE_BASES,
      { mergeBases: [`${OTHER_BASE}...${HEAD_2}`] },
    );

    const summary = await readRevisionSummary(source);

    expect(refs).toEqual([]);
    expect(summary).toEqual({ format: "pnpm", unread: "unavailable" });
  });

  it(
    "reads the lockfile unread when a merge base side is refused",
    async () => {
      const { source } = stubSpanSource(
        KEPT_OFF_REGISTRY,
        REBASED_MERGE_BASES,
        {
          refs: [MERGE_BASE],
        },
      );

      const summary = await readRevisionSummary(source);

      expect(summary).toEqual({ format: "pnpm", unread: "unavailable" });
    },
    CHILD_TIMEOUT_MS,
  );
});
