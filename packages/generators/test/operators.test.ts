import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGeneratorConfigFile } from "../src/config/loader";
import { validateOperatorsBlock } from "../src/config/operators";

const tempDirs: string[] = [];
function writeConfigFile(contents: string): string {
  const prefix = join(tmpdir(), "mergebrief-operators-");
  const dir = mkdtempSync(prefix);
  tempDirs.push(dir);
  const path = join(dir, "mergebrief.config.yaml");
  writeFileSync(path, contents);
  return path;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The instance `operators` block: the GitHub user ids of the people who run
 * the Instance. An id never changes; a login can be freed and claimed.
 */
describe("validateOperatorsBlock", () => {
  it("parses a list of GitHub user ids", () => {
    const result = validateOperatorsBlock([583231, 9919]);

    expect(result).toEqual({ ok: true, value: new Set([583231n, 9919n]) });
  });

  it("reads an empty list as nobody", () => {
    const result = validateOperatorsBlock([]);

    expect(result).toEqual({ ok: true, value: new Set() });
  });

  it("refuses a login in place of an id", () => {
    const result = validateOperatorsBlock(["dana"]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("operators: 0:");
  });

  it("refuses a non-positive or fractional id", () => {
    for (const id of [0, -4, 12.5]) {
      expect(validateOperatorsBlock([id]).ok).toBe(false);
    }
  });

  it("refuses a block that is not a list", () => {
    expect(validateOperatorsBlock({ ids: [1] }).ok).toBe(false);
  });
});

describe("the operators block inside the instance config file", () => {
  it("lets the full loader boot with the key present", () => {
    const path = writeConfigFile(
      "generator:\n  provider: anthropic\noperators:\n  - 583231\n",
    );

    expect(loadGeneratorConfigFile(path).ok).toBe(true);
  });

  it("refuses a bare operators key with no list under it", () => {
    const path = writeConfigFile(
      "generator:\n  provider: anthropic\noperators:\n",
    );

    expect(loadGeneratorConfigFile(path).ok).toBe(false);
  });

  it("refuses the whole file when the operators block is invalid", () => {
    const path = writeConfigFile(
      "generator:\n  provider: anthropic\noperators:\n  - dana\n",
    );

    expect(loadGeneratorConfigFile(path).ok).toBe(false);
  });
});
