import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGeneratorConfigFile } from "../src/config/loader";
import { capForRepo, validateSpendBlock } from "../src/config/spendPolicy";

/**
 * The instance `spend` block: the parse table (default/override/
 * unset), the positive-integer gate, and the per-repo-beats-default rule.
 * Enforcement lives in the worker's generation gate, not here.
 */

const tempDirs: string[] = [];
function configFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mergebrief-spend-"));
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

describe("validateSpendBlock", () => {
  it("parses a global default plus per-repo overrides", () => {
    const result = validateSpendBlock({
      dailyGenerationCap: 50,
      perRepo: { "acme/api": 5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dailyGenerationCap).toBe(50);
    expect(result.value.perRepo).toEqual({ "acme/api": 5 });
  });

  it("tolerates a perRepo key naming no installed repo", () => {
    // The installation set changes without the operator editing this file.
    const result = validateSpendBlock({ perRepo: { "gone/repo": 3 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dailyGenerationCap).toBeNull();
  });

  it("rejects a non-positive or fractional cap", () => {
    for (const cap of [0, -1, 2.5]) {
      const result = validateSpendBlock({ dailyGenerationCap: cap });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.issues.join("; ")).toContain("spend:");
    }
  });

  it("rejects an unknown key inside the block", () => {
    const result = validateSpendBlock({ monthlyCap: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("unrecognized key");
  });

  it("rejects a perRepo key that is not owner/name", () => {
    const result = validateSpendBlock({ perRepo: { acme: 3 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("owner/name");
  });

  it("refuses two spellings of one slug rather than silently last-wins", () => {
    // Lookup is case-insensitive, so these are ONE repo with two caps: the
    // operator would get one of them, and not predictably. Fail closed.
    const result = validateSpendBlock({
      perRepo: { "Acme/API": 5, "acme/api": 50 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("listed more than once");
    expect(text).toContain("acme/api");
  });

  it("redacts a non-token perRepo key in the issue text", () => {
    // A credential pasted as a stray key must not echo (readRoot posture).
    const result = validateSpendBlock({
      perRepo: { "sk-or-v1-abc123def456": 3 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("sk-or-v1-abc123def456");
  });
});

describe("capForRepo", () => {
  const policy = {
    dailyGenerationCap: 20,
    perRepo: { "acme/api": 5 },
  };

  it("prefers the per-repo override over the default", () => {
    expect(capForRepo(policy, "acme/api")).toBe(5);
  });

  it("falls back to the global default for other repos", () => {
    expect(capForRepo(policy, "acme/web")).toBe(20);
  });

  it("matches the override case-insensitively", () => {
    expect(capForRepo(policy, "Acme/API")).toBe(5);
  });

  it("reports uncapped when nothing is configured", () => {
    expect(capForRepo({ dailyGenerationCap: null, perRepo: {} }, "a/b")).toBe(
      null,
    );
  });
});

describe("the spend block inside the instance config file", () => {
  it("loads alongside the generator block", () => {
    const path = configFile(
      [
        "generator:",
        "  provider: anthropic",
        "spend:",
        "  dailyGenerationCap: 40",
        "  perRepo:",
        "    Acme/API: 5",
        "",
      ].join("\n"),
    );
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spend).toEqual({
      dailyGenerationCap: 40,
      perRepo: { "acme/api": 5 },
    });
  });

  it("defaults to uncapped when the block is absent", () => {
    const path = configFile("generator:\n  provider: anthropic\n");
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spend).toEqual({
      dailyGenerationCap: null,
      perRepo: {},
    });
  });

  it("refuses the whole file when the spend block is invalid", () => {
    const path = configFile(
      "generator:\n  provider: anthropic\nspend:\n  dailyGenerationCap: 0\n",
    );
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(false);
  });
});
