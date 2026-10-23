import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGeneratorConfigFile } from "../src/config/loader";
import { validateSpendBlock } from "../src/config/spendPolicy";

/**
 * The instance `spend` block: one instance-wide cap that defaults to 300,
 * the positive-integer-or-unlimited gate, and the strict-key refusal of the
 * retired per-repo shape. Enforcement lives in the worker's generation gate.
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
  it("parses maxGenerationsPerDay", () => {
    const result = validateSpendBlock({ maxGenerationsPerDay: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.maxGenerationsPerDay).toBe(50);
  });

  it("defaults to 300 a day when the block names no cap", () => {
    const result = validateSpendBlock({});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.maxGenerationsPerDay).toBe(300);
  });

  it("reads unlimited as uncapped", () => {
    const result = validateSpendBlock({ maxGenerationsPerDay: "unlimited" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.maxGenerationsPerDay).toBeNull();
  });

  it.each([0, -1, 2.5, "Unlimited", "none", null])(
    "refuses %s as the cap and names the field",
    (cap) => {
      const result = validateSpendBlock({ maxGenerationsPerDay: cap });
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      const text = result.error.issues.join("; ");
      expect(text).toBe(
        'spend: "maxGenerationsPerDay": must be a positive whole number or "unlimited"',
      );
    },
  );

  it("refuses the retired dailyGenerationCap key", () => {
    const result = validateSpendBlock({ dailyGenerationCap: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("unrecognized key");
    expect(text).toContain("dailyGenerationCap");
  });

  it("refuses the retired perRepo map", () => {
    const result = validateSpendBlock({ perRepo: { "acme/api": 5 } });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("unrecognized key");
    expect(text).toContain("perRepo");
  });

  it("redacts a credential-shaped stray key in the issue text", () => {
    const result = validateSpendBlock({ "sk-or-v1-abc123def456": 3 });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("sk-or-v1-abc123def456");
  });
});

describe("the spend block inside the instance config file", () => {
  it("loads alongside the generator block", () => {
    const path = configFile(
      [
        "generator:",
        "  provider: anthropic",
        "spend:",
        "  maxGenerationsPerDay: 40",
        "",
      ].join("\n"),
    );
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.spend).toEqual({ maxGenerationsPerDay: 40 });
  });

  it("defaults to 300 a day when the block is absent", () => {
    const path = configFile("generator:\n  provider: anthropic\n");
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.spend).toEqual({ maxGenerationsPerDay: 300 });
  });

  it("loads maxGenerationsPerDay: unlimited as uncapped", () => {
    const path = configFile(
      "generator:\n  provider: anthropic\nspend:\n  maxGenerationsPerDay: unlimited\n",
    );
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.spend).toEqual({ maxGenerationsPerDay: null });
  });

  it("refuses the whole file when the spend block is invalid", () => {
    const path = configFile(
      "generator:\n  provider: anthropic\nspend:\n  maxGenerationsPerDay: 0\n",
    );
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(false);
  });
});
