import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGeneratorConfig, loadGeneratorConfigFile } from "../src/config/loader";

/**
 * The instance-config loader table (BRIEF-11 decision 6): every fail-fast
 * arm, the zero-config default, the x-* carve-out, and the strictness
 * gates. Adapter-level option validation is the registry's (already-tested)
 * job — one representative valid/invalid block each suffices here.
 */

const tempDirs: string[] = [];
function configFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mergebrief-config-"));
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

describe("loadGeneratorConfig (env-driven)", () => {
  it("returns zero-config defaults when MERGEBRIEF_CONFIG is unset", () => {
    const result = loadGeneratorConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      generator: { provider: "anthropic" },
      source: null,
    });
  });

  it("fails fast on a set-but-empty MERGEBRIEF_CONFIG (unset ≠ empty)", () => {
    const result = loadGeneratorConfig({ MERGEBRIEF_CONFIG: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("not readable");
  });

  it("loads the file the env var points at", () => {
    const path = configFile("generator:\n  provider: anthropic\n  model: claude-sonnet-5\n");
    const result = loadGeneratorConfig({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generator).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(result.value.source).toBe(path);
  });
});

describe("loadGeneratorConfigFile", () => {
  it("fails fast on an unreadable path without echoing content", () => {
    const result = loadGeneratorConfigFile("/nonexistent/mergebrief.config.yaml");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("not readable (ENOENT)");
  });

  it("reports invalid YAML by position only", () => {
    const path = configFile("generator:\n  provider: [unclosed\nsk-secret-SENTINEL: x\n");
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("not valid YAML");
    // File content (which could carry a pasted credential) never echoes.
    expect(text).not.toContain("SENTINEL");
  });

  it("keeps parser warnings (which embed source lines) off stderr", () => {
    // An unresolved tag triggers a WARNING whose text quotes the line —
    // exactly where a pasted credential could sit. logLevel "error" must
    // silence the warning channel entirely.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const emitSpy = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => {});
    try {
      const result = loadGeneratorConfigFile(
        configFile("x-note: !mystery sk-live-SENTINEL-000\n"),
      );
      expect(result.ok).toBe(true);
      const seen = JSON.stringify([...warnSpy.mock.calls, ...emitSpy.mock.calls]);
      expect(seen).not.toContain("SENTINEL");
    } finally {
      warnSpy.mockRestore();
      emitSpy.mockRestore();
    }
  });

  it("accepts an empty file as zero-config", () => {
    const path = configFile("");
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generator).toEqual({ provider: "anthropic" });
  });

  it("rejects a non-mapping root", () => {
    const result = loadGeneratorConfigFile(configFile("- just\n- a list\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("root must be a YAML mapping");
  });

  it("rejects unknown root keys, echoing token-shaped names only", () => {
    const result = loadGeneratorConfigFile(
      configFile('generator:\n  provider: anthropic\ngeneraotr: typo\n"sk-or-abc123456789": x\n'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain('"generaotr"');
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("sk-or-abc");
  });

  it("lets x-* root keys pass (compose convention)", () => {
    const result = loadGeneratorConfigFile(
      configFile("x-anchors:\n  shared: 1\ngenerator:\n  provider: anthropic\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("defaults the generator when the block is absent", () => {
    const result = loadGeneratorConfigFile(configFile("x-notes: only extensions here\n"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generator).toEqual({ provider: "anthropic" });
  });

  it("rejects an unknown provider with the vocabulary named", () => {
    const result = loadGeneratorConfigFile(
      configFile("generator:\n  provider: gemini\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("generator:");
    expect(text).toContain('unknown provider "gemini"');
    expect(text).toContain("anthropic");
  });

  it("rejects unknown generator keys through the registry's strict schemas", () => {
    const result = loadGeneratorConfigFile(
      configFile("generator:\n  provider: anthropic\n  modle: typo\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain('"modle"');
  });

  it("parses harness timer tunables on a CLI adapter block", () => {
    const result = loadGeneratorConfigFile(
      configFile(
        "generator:\n  provider: claude-code\n  model: claude-sonnet-5\n  timeouts:\n    hardMs: 600000\n    inactivityMs: 120000\n",
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generator).toEqual({
      provider: "claude-code",
      model: "claude-sonnet-5",
      timeouts: { hardMs: 600_000, inactivityMs: 120_000 },
    });
  });
});
