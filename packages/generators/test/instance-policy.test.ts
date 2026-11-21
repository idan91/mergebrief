import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyDefaultConfigPath,
  loadInstancePolicy,
} from "../src/config/instancePolicy";

/**
 * The narrow instance-policy loader: the api process
 * reads ONLY the `drafts`, `spend`, `operators`, `allowed` and `attachments`
 * blocks out of
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

const DEFAULT_POLICY = { debounceSeconds: null };

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
      attachments: {},
      audit: { privateWrites: true },
      updateCheck: { enabled: true },
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
      "drafts:\n  debounceSeconds: 300\n",
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
    expect(result.value.draftPolicy.debounceSeconds).toBe(300);
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
      attachments: {},
      audit: { privateWrites: true },
      updateCheck: { enabled: true },
      source: path,
    });
  });

  it("parses debounceSeconds", () => {
    const path = configFile("drafts:\n  debounceSeconds: 900\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.draftPolicy).toEqual({ debounceSeconds: 900 });
  });

  it("refuses the removed generate key, naming readyForReview", () => {
    for (const doc of [
      "drafts:\n  generate: off\n",
      "drafts:\n  generate: on\n  debounceSeconds: 900\n",
    ]) {
      const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: configFile(doc) });
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      const text = result.error.issues.join("; ");
      expect(text).toContain("drafts: generate: removed");
      expect(text).toContain("triggerConditions.readyForReview: on");
    }
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
    const path = configFile("drafts:\n  debouceSeconds: 900\n");
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
      "generator:\n  provider: no-such-provider\ndrafts:\n  debounceSeconds: 300\n",
    );
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.draftPolicy.debounceSeconds).toBe(300);
  });

  it("ignores unknown root keys, leaving strictness to the full loader", () => {
    const path = configFile("mystery: 1\ndrafts:\n  debounceSeconds: 300\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.draftPolicy.debounceSeconds).toBe(300);
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

describe("loadInstancePolicy attachments", () => {
  it("reads no attachment setting from a file without the block", () => {
    const path = configFile("operators: []\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok && result.value.attachments).toEqual({});
  });

  it("reads the four attachment settings", () => {
    const path = configFile(
      "attachments:\n  quotaFiles: 3\n  quotaMb: 50\n  quotaWindowMinutes: 60\n  mediaMaxMb: 250\n",
    );
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok && result.value.attachments).toEqual({
      quotaFiles: 3,
      quotaMb: 50,
      quotaWindowMinutes: 60,
      mediaMaxMb: 250,
    });
  });

  it.each([0, -5, 1.5, "lots"])(
    "refuses a mediaMaxMb of %s without echoing it",
    (value) => {
      const path = configFile(
        `attachments:\n  mediaMaxMb: ${JSON.stringify(value)}\n`,
      );
      const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.issues).toEqual([
        "attachments: mediaMaxMb: must be a positive whole number",
      ]);
    },
  );

  it("refuses an unknown key in the attachments block by name", () => {
    const path = configFile("attachments:\n  quotaFile: 3\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain(
      'attachments: unrecognized key "quotaFile"',
    );
  });

  it("redacts a secret-shaped unknown key inside the attachments block", () => {
    const path = configFile('attachments:\n  "sk-ant-api03-SENTINEL999": 3\n');
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("SENTINEL999");
  });

  it.each([
    ["MERGEBRIEF_ATTACHMENT_QUOTA_FILES", "attachments.quotaFiles"],
    ["MERGEBRIEF_ATTACHMENT_QUOTA_MB", "attachments.quotaMb"],
    [
      "MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES",
      "attachments.quotaWindowMinutes",
    ],
    ["MERGEBRIEF_MEDIA_MAX_MB", "attachments.mediaMaxMb"],
  ])("refuses %s still set in the environment", (variable, configKey) => {
    const result = loadInstancePolicy({ [variable]: "leak-marker" });
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

  it("ignores a moved variable left empty", () => {
    const result = loadInstancePolicy({ MERGEBRIEF_MEDIA_MAX_MB: " " });
    expect(result.ok).toBe(true);
  });
});

describe("loadInstancePolicy audit", () => {
  it("reads audit.privateWrites false as off", () => {
    const path = configFile("audit:\n  privateWrites: false\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok && result.value.audit).toEqual({ privateWrites: false });
  });

  it.each(["false", "true", ""])(
    "refuses AUDIT_PRIVATE_WRITES set to '%s' in the environment",
    (value) => {
      // Empty used to read as false, so an empty leftover must not pass as on.
      const result = loadInstancePolicy({ AUDIT_PRIVATE_WRITES: value });
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.issues).toEqual([
        "AUDIT_PRIVATE_WRITES: moved to audit.privateWrites in mergebrief.config.yaml",
      ]);
    },
  );

  it("redacts a secret-shaped unknown key inside the audit block", () => {
    const path = configFile('audit:\n  "sk-ant-api03-SENTINEL999": true\n');
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("SENTINEL999");
  });
});

describe("loadInstancePolicy update check", () => {
  it("leaves the update check on when the file names no block", () => {
    const path = configFile("operators: []\n");
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok && result.value.updateCheck).toEqual({ enabled: true });
  });

  it("reads updateCheck.enabled false and a mirror url", () => {
    const path = configFile(
      "updateCheck:\n  enabled: false\n  url: https://mirror.example.test/version.json\n",
    );
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok && result.value.updateCheck).toEqual({
      enabled: false,
      url: "https://mirror.example.test/version.json",
    });
  });

  it.each(["off", "false", 0])("refuses an enabled of %j", (value) => {
    const path = configFile(
      `updateCheck:\n  enabled: ${JSON.stringify(value)}\n`,
    );
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toEqual([
      "updateCheck: enabled: must be true or false",
    ]);
  });

  it("redacts a secret-shaped unknown key inside the updateCheck block", () => {
    const path = configFile(
      'updateCheck:\n  "sk-ant-api03-SENTINEL999": true\n',
    );
    const result = loadInstancePolicy({ MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("SENTINEL999");
  });

  it.each([
    ["MERGEBRIEF_UPDATE_CHECK", "updateCheck.enabled"],
    ["MERGEBRIEF_UPDATE_CHECK_URL", "updateCheck.url"],
  ])("refuses %s still set in the environment", (variable, configKey) => {
    const result = loadInstancePolicy({ [variable]: "leak-marker" });
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

describe("applyDefaultConfigPath", () => {
  /** A workspace root holding the marker file, and a member directory inside it. */
  function makeWorkspace(): { root: string; memberDir: string } {
    const root = mkdtempSync(join(tmpdir(), "mergebrief-workspace-"));
    tempDirs.push(root);
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const memberDir = join(root, "apps", "api");
    mkdirSync(memberDir, { recursive: true });
    return { root, memberDir };
  }

  it("names the workspace root's file when the variable is unset", () => {
    const { root, memberDir } = makeWorkspace();
    const file = join(root, "mergebrief.config.yaml");
    writeFileSync(file, "operators:\n  - 583231\n");

    const env = applyDefaultConfigPath({ LOG_LEVEL: "info" }, memberDir);

    expect(env).toEqual({ LOG_LEVEL: "info", MERGEBRIEF_CONFIG: file });
    const policy = loadInstancePolicy(env);
    expect(policy.ok && policy.value.source).toBe(file);
  });

  it("leaves the variable unset when the root holds no such file", () => {
    const { memberDir } = makeWorkspace();
    expect(applyDefaultConfigPath({}, memberDir)).toEqual({});
  });

  it("leaves the variable unset outside a workspace", () => {
    const outside = mkdtempSync(join(tmpdir(), "mergebrief-outside-"));
    tempDirs.push(outside);
    writeFileSync(join(outside, "mergebrief.config.yaml"), "operators: []\n");

    expect(applyDefaultConfigPath({}, outside)).toEqual({});
  });

  it.each(["elsewhere.yaml", ""])("keeps a variable set to %j", (value) => {
    const { root, memberDir } = makeWorkspace();
    writeFileSync(join(root, "mergebrief.config.yaml"), "operators: []\n");

    const env = applyDefaultConfigPath({ MERGEBRIEF_CONFIG: value }, memberDir);

    expect(env).toEqual({ MERGEBRIEF_CONFIG: value });
  });
});
