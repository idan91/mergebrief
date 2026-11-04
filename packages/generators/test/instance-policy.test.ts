import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadInstancePolicy } from "../src/config/instancePolicy";

/**
 * The narrow instance-policy loader: the api process
 * reads ONLY the `drafts`, `spend`, `operators` and `allowed` blocks out of
 * mergebrief.config.yaml. It must
 * succeed on files whose generator block would refuse the full loader;
 * the api never validates adapters and never needs provider keys.
 */

const tempDirs: string[] = [];
function configFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mergebrief-policy-"));
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

const DEFAULT_POLICY = { generate: true, debounceSeconds: null };

describe("loadInstancePolicy", () => {
  it("returns the default policy when MERGEBRIEF_CONFIG is unset", () => {
    const result = loadInstancePolicy({});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({
      draftPolicy: DEFAULT_POLICY,
      spendPolicy: { maxGenerationsPerDay: 300 },
      operatorIds: new Set(),
      source: null,
    });
  });

  it("anchors a relative MERGEBRIEF_CONFIG at the workspace root, not cwd", () => {
    // The api process and the worker must resolve one env value to the
    // SAME file. Pin this loader to the shared resolver, not bare cwd.
    const root = mkdtempSync(join(tmpdir(), "mergebrief-policy-ws-"));
    tempDirs.push(root);
    writeFileSync(
      join(root, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n',
    );
    writeFileSync(
      join(root, "mergebrief.config.yaml"),
      "drafts:\n  generate: off\n",
    );
    const nested = join(root, "apps", "web");
    mkdirSync(nested, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(nested);

    const result = loadInstancePolicy({
      MERGEBRIEF_CONFIG: "mergebrief.config.yaml",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.draftPolicy.generate).toBe(false);
    expect(result.value.source).toBe(join(root, "mergebrief.config.yaml"));
  });

  it("returns the default policy for a file without a drafts block", () => {
    const path = configFile("generator:\n  provider: anthropic\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({
      draftPolicy: DEFAULT_POLICY,
      spendPolicy: { maxGenerationsPerDay: 300 },
      operatorIds: new Set(),
      source: path,
    });
  });

  it("parses generate: off", () => {
    const path = configFile("drafts:\n  generate: off\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.draftPolicy).toEqual({
      generate: false,
      debounceSeconds: null,
    });
  });

  it("parses generate: on as a YAML 1.2 string and boolean true alike", () => {
    for (const doc of [
      "drafts:\n  generate: on\n",
      "drafts:\n  generate: true\n",
    ]) {
      const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: configFile(doc) });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.draftPolicy.generate).toBe(true);
    }
  });

  it("parses debounceSeconds", () => {
    const path = configFile(
      "drafts:\n  generate: on\n  debounceSeconds: 900\n",
    );
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.draftPolicy).toEqual({
      generate: true,
      debounceSeconds: 900,
    });
  });

  it("defaults generate to on when only debounceSeconds is set", () => {
    const path = configFile("drafts:\n  debounceSeconds: 600\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.draftPolicy).toEqual({
      generate: true,
      debounceSeconds: 600,
    });
  });

  it("rejects a non-positive or non-finite debounceSeconds", () => {
    for (const bad of ["0", "-60", "not-a-number"]) {
      const result = loadInstancePolicy({
        MERGEBRIEF_CONFIG: configFile(`drafts:\n  debounceSeconds: ${bad}\n`),
      });
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.issues.join("; ")).toContain("drafts:");
    }
  });

  it("rejects an unknown key in the drafts block, echoing token-shaped keys", () => {
    const path = configFile("drafts:\n  generate: on\n  debouceSeconds: 900\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("drafts:");
    expect(text).toContain('"debouceSeconds"');
  });

  it("redacts secret-shaped unknown keys inside the drafts block", () => {
    // A pasted credential used as a stray KEY must never echo (same posture
    // as the full loader's root-key redaction).
    const path = configFile('drafts:\n  "sk-ant-api03-SENTINEL999": true\n');
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("SENTINEL999");
  });

  it("succeeds on a file whose generator block is invalid", () => {
    const path = configFile(
      "generator:\n  provider: no-such-provider\ndrafts:\n  generate: off\n",
    );
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.draftPolicy.generate).toBe(false);
  });

  it("ignores unknown root keys, leaving strictness to the full loader", () => {
    const path = configFile("mystery: 1\ndrafts:\n  generate: off\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.draftPolicy.generate).toBe(false);
  });

  it("fails fast on an unreadable path without echoing content", () => {
    const result = loadInstancePolicy({
      MERGEBRIEF_CONFIG: "/no/such/file.yaml",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("not readable");
  });

  it("fails fast on invalid YAML with position only", () => {
    const path = configFile("drafts: [unclosed\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("not valid YAML");
    expect(result.error.issues.join("; ")).not.toContain("unclosed");
  });
});

describe("loadInstancePolicy spend and operators", () => {
  it("reads the spend cap and the Operator ids from the same file", () => {
    const path = configFile(
      "spend:\n  maxGenerationsPerDay: 50\noperators:\n  - 583231\n",
    );

    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.spendPolicy).toEqual({ maxGenerationsPerDay: 50 });
    expect(result.value.operatorIds).toEqual(new Set([583231n]));
  });

  it("defaults the cap to 300 when the spend block names none", () => {
    const path = configFile("spend: {}\n");

    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.spendPolicy).toEqual({ maxGenerationsPerDay: 300 });
  });

  it("reads maxGenerationsPerDay: unlimited as uncapped", () => {
    const path = configFile("spend:\n  maxGenerationsPerDay: unlimited\n");

    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.spendPolicy).toEqual({ maxGenerationsPerDay: null });
  });

  it("refuses boot on a cap of 0", () => {
    const path = configFile("spend:\n  maxGenerationsPerDay: 0\n");

    expect(loadInstancePolicy({ MERGEBRIEF_CONFIG: path }).ok).toBe(false);
  });

  it("refuses boot on an invalid operators block", () => {
    const path = configFile("operators:\n  - 0\n");

    expect(loadInstancePolicy({ MERGEBRIEF_CONFIG: path }).ok).toBe(false);
  });
});
