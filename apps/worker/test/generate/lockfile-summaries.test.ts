import type { fork } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLockfileSummaries } from "../../src/task/generate/logic/lockfile-summaries";
import { BASE, buildRepoFile, captureLogger, HEAD_1 } from "./helpers";

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
    { base: BASE, head: HEAD_1 },
    logger,
    [],
  );
  const failure = readLines().find((line) =>
    String(line["msg"]).includes("lockfile summary child failed"),
  );
  return { summary: summaries.get(LOCKFILE), reason: failure?.["reason"] };
}

describe("readLockfileSummaries span budget", () => {
  afterEach(() => {
    vi.useRealTimers();
    childForks.count = 0;
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
