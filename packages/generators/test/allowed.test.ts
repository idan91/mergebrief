import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateAllowedBlock } from "../src/config/allowed";
import { loadInstancePolicy } from "../src/config/instancePolicy";
import { loadGeneratorConfigFile } from "../src/config/loader";

const tempDirs: string[] = [];
function writeConfigFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mergebrief-allowed-"));
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

describe("validateAllowedBlock", () => {
  it("parses user ids and account ids", () => {
    const result = validateAllowedBlock({ users: [583231], accounts: [9919] });

    expect(result).toEqual({
      ok: true,
      value: { users: new Set([583231n]), accounts: new Set([9919n]) },
    });
  });

  it("reads an absent list as empty", () => {
    const result = validateAllowedBlock({ accounts: [9919] });

    expect(result).toEqual({
      ok: true,
      value: { users: new Set(), accounts: new Set([9919n]) },
    });
  });

  it("takes two empty lists as Operators only", () => {
    const result = validateAllowedBlock({ users: [], accounts: [] });

    expect(result).toEqual({
      ok: true,
      value: { users: new Set(), accounts: new Set() },
    });
  });

  it("refuses a block that names neither list", () => {
    const result = validateAllowedBlock({});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("allowed:");
  });

  it("refuses a bare block", () => {
    expect(validateAllowedBlock(null).ok).toBe(false);
  });

  it("refuses a login in place of an id", () => {
    const result = validateAllowedBlock({ users: ["dana"] });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("allowed: users.0:");
  });

  it("refuses a non-positive or fractional id", () => {
    for (const id of [0, -4, 12.5]) {
      expect(validateAllowedBlock({ accounts: [id] }).ok).toBe(false);
    }
  });

  it("does not echo an unknown key's text", () => {
    const pasted = "ghp_pasted_credential";
    const result = validateAllowedBlock({ users: [1], [pasted]: [2] });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).not.toContain(pasted);
  });
});

describe("the allowed block in the config file", () => {
  it("is absent from the policy when the file omits it", () => {
    const path = writeConfigFile("operators:\n  - 583231\n");

    const policy = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });

    expect(policy.ok).toBe(true);
    if (!policy.ok) {
      return;
    }
    expect(policy.value.allowedAccess).toBeUndefined();
  });

  it("reaches the api's policy", () => {
    const path = writeConfigFile("allowed:\n  accounts:\n    - 9919\n");

    const policy = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });

    expect(policy.ok).toBe(true);
    if (!policy.ok) {
      return;
    }
    expect(policy.value.allowedAccess).toEqual({
      users: new Set(),
      accounts: new Set([9919n]),
    });
  });

  it("refuses the api's boot on a bad block", () => {
    const path = writeConfigFile("allowed:\n  users:\n    - dana\n");

    expect(loadInstancePolicy({ MERGEBRIEF_CONFIG: path }).ok).toBe(false);
  });

  it("is a known root key to the full loader", () => {
    const path = writeConfigFile(
      "generator:\n  provider: anthropic\nallowed:\n  users:\n    - 583231\n",
    );

    expect(loadGeneratorConfigFile(path).ok).toBe(true);
  });

  it("refuses the worker's boot on a bad block", () => {
    const path = writeConfigFile(
      "generator:\n  provider: anthropic\nallowed:\n  users:\n    - dana\n",
    );

    expect(loadGeneratorConfigFile(path).ok).toBe(false);
  });
});
