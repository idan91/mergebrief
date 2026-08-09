import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistRunBriefs } from "../eval/specimens";

/**
 * Specimens are the only inspectable evidence for flaky properties. An
 * all-failure invocation must never destroy the previous run's specimens.
 */

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-specimens-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("persistRunBriefs", () => {
  it("replaces stale specimens with the scored runs' briefs", () => {
    const runsDir = join(tempDir(), "some-case");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, "run-9.brief.json"), "{}\n");
    persistRunBriefs(runsDir, {
      briefs: [{ marker: "first" }, { marker: "third" }],
      runNumbers: [1, 3],
      failureMessages: ["run 2: boom"],
    });
    expect(existsSync(join(runsDir, "run-9.brief.json"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(runsDir, "run-1.brief.json"), "utf8")),
    ).toEqual({ marker: "first" });
    expect(
      JSON.parse(readFileSync(join(runsDir, "run-3.brief.json"), "utf8")),
    ).toEqual({ marker: "third" });
  });

  it("keeps prior specimens when the invocation scored zero briefs", () => {
    const runsDir = join(tempDir(), "some-case");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, "run-1.brief.json"), '{"kept":true}\n');
    persistRunBriefs(runsDir, {
      briefs: [],
      runNumbers: [],
      failureMessages: ["run 1: 400", "run 2: 400"],
    });
    expect(
      JSON.parse(readFileSync(join(runsDir, "run-1.brief.json"), "utf8")),
    ).toEqual({ kept: true });
    expect(
      JSON.parse(readFileSync(join(runsDir, "failure-messages.json"), "utf8")),
    ).toEqual(["run 1: 400", "run 2: 400"]);
  });

  it("writes failure messages even when the case dir does not exist yet", () => {
    const runsDir = join(tempDir(), "brand-new-case");
    persistRunBriefs(runsDir, {
      briefs: [],
      runNumbers: [],
      failureMessages: ["run 1: no key"],
    });
    expect(
      JSON.parse(readFileSync(join(runsDir, "failure-messages.json"), "utf8")),
    ).toEqual(["run 1: no key"]);
  });

  it("drops a previous run's failure messages once briefs score again", () => {
    const runsDir = join(tempDir(), "some-case");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, "failure-messages.json"), '["run 1: old"]\n');
    persistRunBriefs(runsDir, {
      briefs: [{ marker: "fresh" }],
      runNumbers: [1],
      failureMessages: [],
    });
    expect(existsSync(join(runsDir, "failure-messages.json"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(runsDir, "run-1.brief.json"), "utf8")),
    ).toEqual({ marker: "fresh" });
  });
});
