import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadGeneratorConfig,
  loadGeneratorConfigFile,
} from "../src/config/loader";
import { resolveEnvConfigPath } from "../src/config/readRoot";

/**
 * The instance-config loader table: every fail-fast
 * arm, the zero-config default, the x-* carve-out, and the strictness
 * gates. Adapter-level option validation is the registry's (already-tested)
 * job; one representative valid/invalid block each suffices here.
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
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadGeneratorConfig from env", () => {
  it("returns zero-config defaults when MERGEBRIEF_CONFIG is unset", () => {
    const result = loadGeneratorConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({
      generator: { provider: "anthropic" },
      spend: { maxGenerationsPerDay: 300 },
      contextSources: [],
      trackers: [],
      siblingRepos: false,
      linkFetch: { mode: "public", hosts: [], maxTotalChars: 40_000 },
      retention: { auditDays: null, pullRequestDays: null },
      source: null,
    });
  });

  it("fails fast on a set-but-empty MERGEBRIEF_CONFIG, unset is not empty", () => {
    const result = loadGeneratorConfig({ MERGEBRIEF_CONFIG: "" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("set but empty");
  });

  it("loads the file the env var points at", () => {
    const path = configFile(
      "generator:\n  provider: anthropic\n  model: claude-sonnet-5\n",
    );
    const result = loadGeneratorConfig({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.generator).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(result.value.source).toBe(path);
  });

  it("anchors a relative MERGEBRIEF_CONFIG at the workspace root, not cwd", () => {
    // Fake workspace: root marker + config at root, cwd deep inside a
    // package dir, the exact worker/web shape (`pnpm --dir`).
    const root = mkdtempSync(join(tmpdir(), "mergebrief-ws-"));
    tempDirs.push(root);
    writeFileSync(
      join(root, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n',
    );
    writeFileSync(
      join(root, "mergebrief.config.yaml"),
      "generator:\n  provider: anthropic\n  model: claude-sonnet-5\n",
    );
    const nested = join(root, "packages", "worker");
    mkdirSync(nested, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(nested);

    const result = loadGeneratorConfig({
      MERGEBRIEF_CONFIG: "mergebrief.config.yaml",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.generator).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(result.value.source).toBe(join(root, "mergebrief.config.yaml"));
  });
});

describe("resolveEnvConfigPath", () => {
  it("passes absolute paths through untouched", () => {
    const result = resolveEnvConfigPath("/etc/mergebrief.yaml", "/anywhere");
    expect(result).toEqual({ ok: true, value: "/etc/mergebrief.yaml" });
  });

  it("resolves against the nearest ancestor with pnpm-workspace.yaml", () => {
    const root = mkdtempSync(join(tmpdir(), "mergebrief-ws-"));
    tempDirs.push(root);
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const nested = join(root, "apps", "web");
    mkdirSync(nested, { recursive: true });

    const result = resolveEnvConfigPath("mergebrief.config.yaml", nested);
    expect(result).toEqual({
      ok: true,
      value: join(root, "mergebrief.config.yaml"),
    });
  });

  it("refuses a relative path with no workspace root above cwd", () => {
    const orphan = mkdtempSync(join(tmpdir(), "mergebrief-orphan-"));
    tempDirs.push(orphan);

    const result = resolveEnvConfigPath("mergebrief.config.yaml", orphan);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("workspace root");
    expect(result.error.issues.join("; ")).toContain("absolute path");
  });
});

describe("loadGeneratorConfigFile", () => {
  it("fails fast on an unreadable path without echoing content", () => {
    const result = loadGeneratorConfigFile(
      "/nonexistent/mergebrief.config.yaml",
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("not readable (ENOENT)");
  });

  it("reports invalid YAML by position only", () => {
    const path = configFile(
      "generator:\n  provider: [unclosed\nsk-secret-SENTINEL: x\n",
    );
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("not valid YAML");
    // File content (which could carry a pasted credential) never echoes.
    expect(text).not.toContain("SENTINEL");
  });

  it("keeps parser warnings, which embed source lines, off stderr", () => {
    // An unresolved tag triggers a WARNING whose text quotes the line;
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
      const seen = JSON.stringify([
        ...warnSpy.mock.calls,
        ...emitSpy.mock.calls,
      ]);
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
    if (!result.ok) {
      return;
    }
    expect(result.value.generator).toEqual({ provider: "anthropic" });
  });

  it("rejects a non-mapping root", () => {
    const result = loadGeneratorConfigFile(configFile("- just\n- a list\n"));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain(
      "root must be a YAML mapping",
    );
  });

  it("rejects unknown root keys, echoing token-shaped names only", () => {
    const result = loadGeneratorConfigFile(
      configFile(
        'generator:\n  provider: anthropic\ngeneraotr: typo\n"sk-or-abc123456789": x\n',
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain('"generaotr"');
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("sk-or-abc");
  });

  it("lets x-* root keys pass, the compose convention", () => {
    const result = loadGeneratorConfigFile(
      configFile(
        "x-anchors:\n  shared: 1\ngenerator:\n  provider: anthropic\n",
      ),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts and validates a drafts root key block", () => {
    const result = loadGeneratorConfigFile(
      configFile(
        "generator:\n  provider: anthropic\ndrafts:\n  generate: on\n  debounceSeconds: 900\n",
      ),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses boot on an invalid drafts block", () => {
    const result = loadGeneratorConfigFile(
      configFile(
        "generator:\n  provider: anthropic\ndrafts:\n  debounceSeconds: -5\n",
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("drafts:");
  });

  it("accepts a contextSources root key block", () => {
    const result = loadGeneratorConfigFile(
      configFile(
        "generator:\n  provider: anthropic\ncontextSources:\n  - type: notion\n    tokenEnv: MY_NOTION_VAR\n",
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.contextSources).toEqual([
      { type: "notion", tokenEnv: "MY_NOTION_VAR" },
    ]);
  });

  it("defaults contextSources to the built-ins when the block is absent", () => {
    const result = loadGeneratorConfigFile(
      configFile("generator:\n  provider: anthropic\n"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.contextSources).toEqual([]);
  });

  it("refuses boot on a bad contextSources entry", () => {
    const result = loadGeneratorConfigFile(
      configFile("contextSources:\n  - type: linear\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toBe("invalid context source configuration");
    expect(result.error.issues.join("; ")).toContain("contextSources");
  });

  it("accepts a trackers root key block in file order", () => {
    const result = loadGeneratorConfigFile(
      configFile(
        "generator:\n  provider: anthropic\ntrackers:\n  - kind: notion\n    keyPrefix: BRIEF\n    databaseId: 1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9\n  - kind: github\n",
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.trackers).toEqual([
      {
        kind: "notion",
        keyPrefix: "BRIEF",
        databaseId: "1a2b3c4d5e6f40718293a4b5c6d7e8f9",
      },
      { kind: "github" },
    ]);
  });

  it("reads siblingRepos off the instance's github tracker entry", () => {
    const result = loadGeneratorConfigFile(
      configFile("trackers:\n  - kind: github\n    siblingRepos: true\n"),
    );
    expect(result.ok && result.value.siblingRepos).toBe(true);
    expect(result.ok && result.value.trackers).toEqual([{ kind: "github" }]);
  });

  it("defaults trackers to none when the block is absent", () => {
    const result = loadGeneratorConfigFile(
      configFile("generator:\n  provider: anthropic\n"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.trackers).toEqual([]);
    expect(result.value.siblingRepos).toBe(false);
  });

  it("refuses boot on a trackers list that names one prefix twice", () => {
    const result = loadGeneratorConfigFile(
      configFile(
        "trackers:\n  - kind: notion\n    keyPrefix: BRIEF\n    databaseId: " +
          "a".repeat(32) +
          "\n  - kind: notion\n    keyPrefix: brief\n    databaseId: " +
          "b".repeat(32) +
          "\n",
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("trackers.");
    expect(result.error.issues.join("; ")).not.toContain("a".repeat(32));
  });

  it("defaults the generator when the block is absent", () => {
    const result = loadGeneratorConfigFile(
      configFile("x-notes: only extensions here\n"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.generator).toEqual({ provider: "anthropic" });
  });

  it("rejects an unknown provider with the vocabulary named", () => {
    const result = loadGeneratorConfigFile(
      configFile("generator:\n  provider: gemini\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("generator:");
    expect(text).toContain('unknown provider "gemini"');
    expect(text).toContain("anthropic");
  });

  it("parses harness timer tunables on a CLI adapter block", () => {
    const result = loadGeneratorConfigFile(
      configFile(
        "generator:\n  provider: claude-code\n  model: claude-sonnet-5\n  timeouts:\n    hardMs: 600000\n    inactivityMs: 120000\n",
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.generator).toEqual({
      provider: "claude-code",
      model: "claude-sonnet-5",
      timeouts: { hardMs: 600_000, inactivityMs: 120_000 },
    });
  });
});

describe("loadGeneratorConfig on the attachments block and moved variables", () => {
  it("accepts an attachments root block", () => {
    const path = configFile("attachments:\n  quotaFiles: 3\n");
    expect(loadGeneratorConfigFile(path).ok).toBe(true);
  });

  it("refuses a bad attachments block, as the api does", () => {
    const path = configFile("attachments:\n  quotaFiles: 0\n");
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toEqual([
      "attachments: quotaFiles: must be a positive whole number",
    ]);
  });

  it.each([
    ["REVISION_NARRATIVE_ENABLED", "generator.revisionNarrative"],
    ["HUGE_SPAN_RATIO", "generator.hugeSpanRatio"],
  ])("refuses %s still set in the environment", (variable, configKey) => {
    const result = loadGeneratorConfig({ [variable]: "leak-marker" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain(
      `${variable}: moved to ${configKey} in mergebrief.config.yaml`,
    );
    expect(text).not.toContain("leak-marker");
  });
});

describe("loadGeneratorConfig on the retention and audit blocks", () => {
  it("keeps rows forever when the file names no retention window", () => {
    const path = configFile("operators: []\n");
    const result = loadGeneratorConfigFile(path);
    expect(result.ok && result.value.retention).toEqual({
      auditDays: null,
      pullRequestDays: null,
    });
  });

  it("reads both retention windows", () => {
    const path = configFile(
      "retention:\n  auditDays: 365\n  pullRequestDays: 90\n",
    );
    const result = loadGeneratorConfigFile(path);
    expect(result.ok && result.value.retention).toEqual({
      auditDays: 365,
      pullRequestDays: 90,
    });
  });

  it("refuses a bad audit block, as the api does", () => {
    const path = configFile("audit:\n  privateWrites: maybe\n");
    const result = loadGeneratorConfigFile(path);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toEqual([
      "audit: privateWrites: must be true or false",
    ]);
  });

  it.each([
    ["AUDIT_RETENTION_DAYS", "retention.auditDays"],
    ["PR_RETENTION_DAYS", "retention.pullRequestDays"],
  ])("refuses %s still set in the environment", (variable, configKey) => {
    const result = loadGeneratorConfig({ [variable]: "365" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain(
      `${variable}: moved to ${configKey} in mergebrief.config.yaml`,
    );
  });
});
