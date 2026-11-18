import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkBaselines } from "../src/gate";
import { listChangedFiles, readChangeRecords } from "../src/logic/git";
import { BASE_REF_ENV_VAR } from "../src/consts";
import { BaseErrorCodes, ChangeKinds } from "../src/types";
import {
  LINT_CONFIG_WITH_RULES,
  makeCheckout,
  runGit,
  stubManifest,
  stubSuppressions,
  writeTree,
  type Tree,
} from "./helpers";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLEAN_TREE: Tree = {
  "package.json": stubManifest("depcruise apps"),
  ".oxlintrc.json": LINT_CONFIG_WITH_RULES,
  "oxlint-suppressions.json": stubSuppressions({
    "src/a.ts": { "house/no-em-dash": 3 },
  }),
  "src/a.ts": "export const a = 1;\n",
};

describe("base ref resolution", () => {
  it("refuses a ref this checkout does not carry", () => {
    const checkout = makeCheckout(CLEAN_TREE);
    try {
      const result = checkBaselines(checkout.root, "release");
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error).toMatchObject({ code: BaseErrorCodes.UNKNOWN_REF });
      expect(result.error.message).toContain("fetch it");
    } finally {
      checkout.dispose();
    }
  });

  it("refuses a directory that is not a git work tree", () => {
    const root = mkdtempSync(join(tmpdir(), "baselines-bare-"));
    try {
      const result = checkBaselines(root, "main");
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error).toMatchObject({
        code: BaseErrorCodes.NOT_A_REPOSITORY,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const TSX_BIN = join(PACKAGE_ROOT, "node_modules/.bin/tsx");

/**
 * The base ref is pinned per case: the child would otherwise inherit an
 * ambient `MERGEBRIEF_BASELINE_BASE`, and the suite's verdict would depend on
 * the caller's shell.
 */
function runGate(cwd: string, baseRef: string): number {
  const run = spawnSync(TSX_BIN, [join(PACKAGE_ROOT, "src/main.ts")], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, [BASE_REF_ENV_VAR]: baseRef },
  });
  return run.status ?? -1;
}

describe("the gate process", () => {
  it("exits zero on a tree that only lost entries", () => {
    const checkout = makeCheckout(CLEAN_TREE, {
      "src/a.ts": "export const a = 11;\n",
      "oxlint-suppressions.json": stubSuppressions({}),
    });
    try {
      expect(runGate(checkout.root, "main")).toBe(0);
    } finally {
      checkout.dispose();
    }
  });

  it("exits nonzero on an edited file that kept its debt", () => {
    const checkout = makeCheckout(CLEAN_TREE, {
      "src/a.ts": "export const a = 11;\n",
    });
    try {
      expect(runGate(checkout.root, "main")).toBe(1);
    } finally {
      checkout.dispose();
    }
  });

  it("exits nonzero when the base ref shares no history with HEAD", () => {
    const checkout = makeCheckout(CLEAN_TREE);
    try {
      runGit(checkout.root, ["checkout", "--orphan", "unrelated"]);
      writeTree(checkout.root, { "src/z.ts": "export const z = 1;\n" });
      runGit(checkout.root, ["add", "-A"]);
      runGit(checkout.root, ["commit", "-m", "unrelated root"]);
      const result = checkBaselines(checkout.root, "main");
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error).toMatchObject({
        code: BaseErrorCodes.NO_MERGE_BASE,
      });
      expect(runGate(checkout.root, "main")).toBe(1);
    } finally {
      checkout.dispose();
    }
  });
});

describe("reading the change set", () => {
  it("refuses when git cannot diff against the base commit", () => {
    const checkout = makeCheckout(CLEAN_TREE);
    try {
      const missing = "0".repeat(40);
      const result = listChangedFiles(checkout.root, missing);
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error).toMatchObject({
        code: BaseErrorCodes.UNREADABLE_TREE,
      });
      expect(result.error.message).toContain("the change set is unknown");
    } finally {
      checkout.dispose();
    }
  });

  it("reads a path carrying a space and a non-ascii name", () => {
    const awkward = "src/a bé.ts";
    const checkout = makeCheckout({
      ...CLEAN_TREE,
      [awkward]: "export const c = 1;\n",
    });
    try {
      const base = runGit(checkout.root, ["rev-parse", "HEAD"]).trim();
      writeTree(checkout.root, { [awkward]: "export const c = 2;\n" });
      const result = listChangedFiles(checkout.root, base);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.map((file) => file.path)).toContain(awkward);
    } finally {
      checkout.dispose();
    }
  });

  it("treats a file replaced by a symlink as an edit", () => {
    const checkout = makeCheckout(CLEAN_TREE);
    try {
      const base = runGit(checkout.root, ["rev-parse", "HEAD"]).trim();
      rmSync(join(checkout.root, "src/a.ts"));
      symlinkSync("./b.ts", join(checkout.root, "src/a.ts"));
      const result = listChangedFiles(checkout.root, base);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value).toContainEqual({
        path: "src/a.ts",
        kind: ChangeKinds.MODIFIED,
      });
    } finally {
      checkout.dispose();
    }
  });
});

describe("name-status framing", () => {
  it("takes the destination of a rename and keeps the source", () => {
    const result = readChangeRecords(["R100", "src/old.ts", "src/new.ts", ""]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual([
      {
        path: "src/new.ts",
        kind: ChangeKinds.RENAMED,
        previousPath: "src/old.ts",
      },
    ]);
  });

  it("takes the destination of a copy and stays in step after it", () => {
    const result = readChangeRecords([
      "C100",
      "src/a.ts",
      "src/copy.ts",
      "M",
      "src/b.ts",
      "",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual([
      { path: "src/copy.ts", kind: ChangeKinds.ADDED },
      { path: "src/b.ts", kind: ChangeKinds.MODIFIED },
    ]);
  });

  it("refuses a status the gate does not model", () => {
    const result = readChangeRecords(["U", "src/a.ts", ""]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatchObject({
      code: BaseErrorCodes.UNREADABLE_TREE,
    });
  });

  it("refuses a two-path status whose destination is missing", () => {
    const result = readChangeRecords(["R100", "src/old.ts"]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("no destination");
  });

  it("reads an empty diff as no changes", () => {
    const result = readChangeRecords([""]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual([]);
  });
});
