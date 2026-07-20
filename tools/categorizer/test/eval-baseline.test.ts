import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadBaseline,
  preflightBaselineKeys,
  saveBaseline,
} from "../eval/baseline";

/**
 * Baselines are checked-in snapshots keyed by provider:model (BRIEF-59
 * decision 5): comparing across keys is refused, not fudged — a Sonnet
 * baseline says nothing about a GPT run.
 */

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-baseline-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("baseline round-trip", () => {
  it("saves and loads scores under the generator key", () => {
    const dir = tempDir();
    saveBaseline(join(dir, "baseline.json"), {
      key: "anthropic:claude-opus-4-8",
      runs: 5,
      properties: { "at-least-two-groups": 5, "no-cross-service": 0 },
    });
    const loaded = loadBaseline(
      join(dir, "baseline.json"),
      "anthropic:claude-opus-4-8",
    );
    expect(loaded).toEqual({
      ok: true,
      value: {
        key: "anthropic:claude-opus-4-8",
        runs: 5,
        properties: { "at-least-two-groups": 5, "no-cross-service": 0 },
      },
    });
  });

  it("writes deterministic, diff-reviewable JSON (sorted property keys)", () => {
    const dir = tempDir();
    const path = join(dir, "baseline.json");
    saveBaseline(path, {
      key: "k:m",
      runs: 5,
      properties: { zebra: 1, alpha: 2 },
    });
    const text = readFileSync(path, "utf8");
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zebra"'));
    expect(text.endsWith("\n")).toBe(true);
  });

  it("refuses a key mismatch instead of comparing across models", () => {
    const dir = tempDir();
    const path = join(dir, "baseline.json");
    saveBaseline(path, { key: "anthropic:opus", runs: 5, properties: {} });
    const loaded = loadBaseline(path, "openai:gpt");
    const error = loaded.ok ? "" : loaded.error;
    expect(loaded.ok).toBe(false);
    expect(error).toContain("anthropic:opus");
    expect(error).toContain("openai:gpt");
  });

  it("reports a missing baseline as absent, not an error", () => {
    const loaded = loadBaseline(join(tempDir(), "baseline.json"), "k:m");
    expect(loaded).toEqual({ ok: true, value: null });
  });

  it("rejects a malformed baseline file loudly", () => {
    const dir = tempDir();
    const path = join(dir, "baseline.json");
    writeFileSync(path, '{"key":42}');
    const loaded = loadBaseline(path, "k:m");
    expect(loaded.ok).toBe(false);
  });
});

describe("preflightBaselineKeys", () => {
  /** Cross-model runs must be refused BEFORE any generation spends money
   * (2026-07-20 incident: full spend, then exit 2 at the baseline lookup). */
  it("passes when every case's baseline matches the run key", () => {
    const a = tempDir();
    const b = tempDir();
    saveBaseline(join(a, "baseline.json"), { key: "k:m", runs: 5, properties: {} });
    saveBaseline(join(b, "baseline.json"), { key: "k:m", runs: 5, properties: {} });
    const result = preflightBaselineKeys(
      [
        { id: "case-a", dir: a },
        { id: "case-b", dir: b },
      ],
      "k:m",
    );
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("allows a case with no baseline yet (new case)", () => {
    const result = preflightBaselineKeys(
      [{ id: "new-case", dir: tempDir() }],
      "k:m",
    );
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("refuses a key mismatch before any spend, naming the case", () => {
    const a = tempDir();
    const b = tempDir();
    saveBaseline(join(a, "baseline.json"), {
      key: "openai:gpt",
      runs: 5,
      properties: {},
    });
    saveBaseline(join(b, "baseline.json"), {
      key: "anthropic:opus",
      runs: 5,
      properties: {},
    });
    const result = preflightBaselineKeys(
      [
        { id: "case-a", dir: a },
        { id: "case-b", dir: b },
      ],
      "openai:gpt",
    );
    const error = result.ok ? "" : result.error;
    expect(result.ok).toBe(false);
    expect(error).toContain("anthropic:opus");
    expect(error).toContain("openai:gpt");
  });
});
