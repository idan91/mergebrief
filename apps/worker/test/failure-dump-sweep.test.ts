// The failure dump sweep over a real folder.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  scheduleFailureDumpSweep,
  sweepFailureDumps,
} from "../src/failure-dump-sweep";
import { captureLogger } from "./generate/helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-14T04:37:00.000Z");

function writeAgedFile(dir: string, name: string, ageDays: number): void {
  const path = join(dir, name);
  writeFileSync(path, "{}");
  const modified = new Date(NOW.getTime() - ageDays * DAY_MS);
  utimesSync(path, modified, modified);
}

describe("sweepFailureDumps", () => {
  it("deletes a dump older than a week and logs the count", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dump-sweep-"));
    writeAgedFile(dir, "brief-1.failed.json", 8);
    writeAgedFile(dir, "brief-2.failed.json", 6);
    writeAgedFile(dir, "notes.txt", 30);
    const { logger, readLines } = captureLogger();

    await sweepFailureDumps({ dir, log: logger, now: () => NOW });

    expect(readdirSync(dir).toSorted()).toEqual([
      "brief-2.failed.json",
      "notes.txt",
    ]);
    expect(readLines().map((line) => line["msg"])).toEqual([
      "failure dump sweep: deleted 1 failure dumps older than 7 days",
    ]);
  });

  it("sweeps past an entry it cannot remove", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dump-sweep-"));
    const folder = join(dir, "a-folder.failed.json");
    const longAgo = new Date(NOW.getTime() - 8 * DAY_MS);
    mkdirSync(folder);
    utimesSync(folder, longAgo, longAgo);
    writeAgedFile(dir, "brief-1.failed.json", 8);
    const { logger } = captureLogger();

    await sweepFailureDumps({ dir, log: logger, now: () => NOW });

    expect(readdirSync(dir)).toEqual(["a-folder.failed.json"]);
  });

  it("does nothing when no generation ever failed", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "dump-sweep-")), "out");
    const { logger, readLines } = captureLogger();

    await sweepFailureDumps({ dir, log: logger, now: () => NOW });

    expect(existsSync(dir)).toBe(false);
    expect(readLines()).toEqual([]);
  });
});

describe("scheduleFailureDumpSweep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sweeps at boot and again a day later in the same process", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const dir = mkdtempSync(join(tmpdir(), "dump-sweep-"));
    writeAgedFile(dir, "at-boot.failed.json", 8);
    const { logger } = captureLogger();

    scheduleFailureDumpSweep({ dir, log: logger, now: () => NOW });
    await vi.waitFor(() => {
      expect(readdirSync(dir)).toEqual([]);
    });

    writeAgedFile(dir, "next-day.failed.json", 8);
    vi.advanceTimersByTime(DAY_MS);
    await vi.waitFor(() => {
      expect(readdirSync(dir)).toEqual([]);
    });
  });
});
