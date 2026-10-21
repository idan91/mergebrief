// The daily npm check: starts beside the command, is taken only if it
// settled by exit, writes a cache, and prints the nag on the next successful
// run, once per answer; a failed run leaves it owed.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  startUpdateCheck,
  type UpdateCheckDeps,
} from "../src/version/update-nag";

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-10-03T10:00:00Z");
const REGISTRY_URL = "https://registry.npmjs.org/mergebrief/latest";

interface Answer {
  readonly body?: unknown;
  readonly status?: number;
  readonly mode?: "settled" | "never" | "reject";
}

interface World {
  readonly cacheDir: string;
  readonly calls: string[];
  run(
    answer: Answer,
    overrides?: Partial<UpdateCheckDeps>,
    succeeded?: boolean,
  ): Promise<string | undefined>;
}

/** The command's own work: a settled answer lands within one macrotask. */
function letTheCommandRun(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeWorld(): World {
  const cacheDir = mkdtempSync(join(tmpdir(), "mb-nag-"));
  const calls: string[] = [];
  return {
    cacheDir,
    calls,
    async run(answer, overrides = {}, succeeded = true) {
      const handle = startUpdateCheck({
        fetch: async (input) => {
          calls.push(input);
          if (answer.mode === "never") {
            return new Promise(() => undefined);
          }
          if (answer.mode === "reject") {
            throw new TypeError("fetch failed");
          }
          return new Response(
            JSON.stringify(answer.body ?? { version: "1.6.0" }),
            {
              status: answer.status ?? 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
        cacheDir,
        env: {},
        cliVersion: "1.2.0",
        now: () => T0,
        ...overrides,
      });
      await letTheCommandRun();
      return handle.settle(succeeded);
    },
  };
}

function readCache(cacheDir: string): unknown {
  return JSON.parse(readFileSync(join(cacheDir, "update-check.json"), "utf8"));
}

function hasCache(cacheDir: string): boolean {
  return existsSync(join(cacheDir, "update-check.json"));
}

describe("the update nag", () => {
  it("first run checks, writes the cache and prints nothing", async () => {
    const world = makeWorld();

    const line = await world.run({});

    expect(line).toBeUndefined();
    expect(world.calls).toEqual([REGISTRY_URL]);
    expect(readCache(world.cacheDir)).toEqual({
      latest: "1.6.0",
      checkedAt: new Date(T0).toISOString(),
      notified: false,
    });
  });

  it("second run prints the nag once from the cache without checking", async () => {
    const world = makeWorld();
    await world.run({});

    const line = await world.run({}, { now: () => T0 + 60_000 });

    expect(line).toBe(
      "A new version of mergebrief is available: 1.2.0 → 1.6.0. To update, run: npm i -g mergebrief@1.6.0",
    );
    expect(world.calls).toHaveLength(1);
    expect(readCache(world.cacheDir)).toMatchObject({ notified: true });
  });

  it("a run a day later checks again and prints on the run after", async () => {
    const world = makeWorld();
    await world.run({});
    await world.run({}, { now: () => T0 + 60_000 });

    const recheck = await world.run(
      { body: { version: "1.7.0" } },
      { now: () => T0 + DAY_MS + 1 },
    );
    const next = await world.run({}, { now: () => T0 + DAY_MS + 2 });

    expect(recheck).toBeUndefined();
    expect(world.calls).toHaveLength(2);
    expect(next).toContain("1.2.0 → 1.7.0");
  });

  it("a failed run prints nothing and leaves the nag owed", async () => {
    const world = makeWorld();
    await world.run({});

    const failed = await world.run({}, { now: () => T0 + 1 }, false);
    const next = await world.run({}, { now: () => T0 + 2 });

    expect(failed).toBeUndefined();
    expect(next).toContain("1.2.0 → 1.6.0");
  });

  it("a failed run takes a settled answer without printing it", async () => {
    const world = makeWorld();

    const failed = await world.run({}, {}, false);
    const next = await world.run({}, { now: () => T0 + 1 });

    expect(failed).toBeUndefined();
    expect(readCache(world.cacheDir)).toMatchObject({ notified: true });
    expect(next).toContain("1.2.0 → 1.6.0");
  });

  it("a run a day after the check prints the owed nag at once", async () => {
    const world = makeWorld();
    await world.run({});

    const later = await world.run(
      { body: { version: "1.7.0" } },
      { now: () => T0 + DAY_MS + 1 },
    );
    const next = await world.run({}, { now: () => T0 + DAY_MS + 2 });

    expect(later).toContain("1.2.0 → 1.7.0");
    expect(readCache(world.cacheDir)).toMatchObject({
      latest: "1.7.0",
      notified: true,
    });
    expect(next).toBeUndefined();
    expect(world.calls).toHaveLength(2);
  });

  it("a cache stamped in the future counts as stale", async () => {
    const world = makeWorld();
    await world.run({}, { now: () => T0 + 400 * DAY_MS });

    await world.run({}, { now: () => T0 });

    expect(world.calls).toHaveLength(2);
  });

  it("picks the npx form when launched through npx", async () => {
    const world = makeWorld();
    await world.run({});

    const line = await world.run(
      {},
      { env: { npm_command: "exec" }, now: () => T0 + 1 },
    );

    expect(line).toContain("To update, run: npx mergebrief@1.6.0");
  });

  it("stays quiet when the registry is not newer", async () => {
    const world = makeWorld();
    await world.run({ body: { version: "1.2.0" } });

    const line = await world.run({}, { now: () => T0 + 1 });

    expect(line).toBeUndefined();
  });

  it("a failing registry prints nothing and leaves the cache untouched", async () => {
    const world = makeWorld();

    const line = await world.run({ mode: "reject" });

    expect(line).toBeUndefined();
    expect(hasCache(world.cacheDir)).toBe(false);
  });

  it("a slow registry is abandoned at exit and leaves the cache untouched", async () => {
    const world = makeWorld();

    const line = await world.run({ mode: "never" });

    expect(line).toBeUndefined();
    expect(hasCache(world.cacheDir)).toBe(false);
  });

  it("a malformed answer prints nothing and leaves the cache untouched", async () => {
    const world = makeWorld();

    const line = await world.run({ body: { nothing: true } });

    expect(line).toBeUndefined();
    expect(hasCache(world.cacheDir)).toBe(false);
  });

  it("a dev build never checks", async () => {
    const world = makeWorld();

    const line = await world.run({}, { cliVersion: "0.0.0" });

    expect(line).toBeUndefined();
    expect(world.calls).toEqual([]);
  });

  it("the opt-out silences it without checking", async () => {
    const world = makeWorld();
    await world.run({});

    const line = await world.run(
      {},
      {
        env: { MERGEBRIEF_NO_VERSION_WARNING: "" },
        now: () => T0 + DAY_MS + 1,
      },
    );

    expect(line).toBeUndefined();
    expect(world.calls).toHaveLength(1);
  });

  it("refuses a registry version that carries trailing text", async () => {
    const world = makeWorld();
    await world.run({ body: { version: "v9.0.0+0; touch /tmp/x" } });

    const line = await world.run({}, { now: () => T0 + 1 });

    expect(line).toBeUndefined();
  });

  it("prints the registry version in canonical form", async () => {
    const world = makeWorld();
    await world.run({ body: { version: "v9.0.0+build.7" } });

    const line = await world.run({}, { now: () => T0 + 1 });

    expect(line).toBe(
      "A new version of mergebrief is available: 1.2.0 → 9.0.0. To update, run: npm i -g mergebrief@9.0.0",
    );
  });

  it("ignores a prerelease from the registry", async () => {
    const world = makeWorld();
    await world.run({ body: { version: "9.0.0-rc.1" } });

    const line = await world.run({}, { now: () => T0 + 1 });

    expect(line).toBeUndefined();
  });
});
