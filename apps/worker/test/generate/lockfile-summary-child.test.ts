import { describe, expect, it } from "vitest";
import { LockfileSideKinds, type LockfileSides } from "brief-core/shortened";
import { summarizeInChild } from "../../src/task/generate/logic/lockfile-summaries/isolated-summary";

const LOCKFILE = "pnpm-lock.yaml";
const CHILD_DEADLINE_MS = 30_000;
const NO_TIME_MS = 0;
const NEVER_STOPS = new AbortController().signal;
const OPEN = { timeoutMs: CHILD_DEADLINE_MS, stop: NEVER_STOPS };

function makeText(resolution: string): string {
  return [
    "lockfileVersion: '9.0'",
    "packages:",
    "  foo@1.0.0:",
    `    resolution: ${resolution}`,
    "snapshots:",
    "  foo@1.0.0: {}",
    "",
  ].join("\n");
}

const SIDES: LockfileSides = {
  before: { kind: LockfileSideKinds.TEXT, text: makeText("{integrity: a}") },
  after: { kind: LockfileSideKinds.TEXT, text: makeText("{integrity: b}") },
};

describe("lockfile summary child process", () => {
  it("reads a lockfile's summary in its own process", async () => {
    const read = await summarizeInChild(LOCKFILE, SIDES, OPEN);

    expect(read).toMatchObject({
      ok: true,
      value: {
        summary: {
          format: "pnpm",
          changes: { sourceChanged: [{ name: "foo", version: "1.0.0" }] },
        },
      },
    });
  });

  it("reads a child past its deadline as timed out", async () => {
    const read = await summarizeInChild(LOCKFILE, SIDES, {
      timeoutMs: NO_TIME_MS,
      stop: NEVER_STOPS,
    });

    expect(read).toEqual({ ok: false, error: "timed-out" });
  });

  it("reads a child that throws as crashed", async () => {
    const malformed = { before: { kind: "text" } } as unknown as LockfileSides;

    const read = await summarizeInChild(LOCKFILE, malformed, OPEN);

    expect(read).toEqual({ ok: false, error: "crashed" });
  });

  it("reads a child whose run stops as stopped", async () => {
    const stop = new AbortController();

    const pending = summarizeInChild(LOCKFILE, SIDES, {
      timeoutMs: CHILD_DEADLINE_MS,
      stop: stop.signal,
    });
    stop.abort();

    expect(await pending).toEqual({ ok: false, error: "stopped" });
  });
});
