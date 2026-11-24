import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { writeTree } from "./helpers";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const HOOK_PATH = "tools/repo-checks/hooks/lint-edited-file.mjs";
const LINT_HOOK = join(REPO_ROOT, HOOK_PATH);
const LINT_LOG = "oxlint-args.log";

// Stands in for oxlint: records its file arguments and reports one finding.
const OXLINT_STUB = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    -*) ;;
    *) printf '%s\\n' "$arg" >> "$(dirname "$0")/../../${LINT_LOG}" ;;
  esac
done
echo "x house(no-enum): stub finding"
exit 1
`;

interface HookRun {
  readonly status: number;
  readonly stderr: string;
}

let root = "";

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeHookRepo(): string {
  root = mkdtempSync(join(tmpdir(), "lint-hook-"));
  mkdirSync(join(root, "tools/repo-checks/hooks"), { recursive: true });
  copyFileSync(LINT_HOOK, join(root, HOOK_PATH));
  writeTree(root, {
    "node_modules/.bin/oxlint": OXLINT_STUB,
    "src/a.ts": "export const a = 1;\n",
    "src/b.tsx": "export const b = 1;\n",
    "src/c.mjs": "export const c = 1;\n",
    "docs/a.md": "# notes\n",
  });
  chmodSync(join(root, "node_modules/.bin/oxlint"), 0o755);
  return root;
}

function runLintHook(input: string): HookRun {
  const run = spawnSync(process.execPath, [join(root, HOOK_PATH)], {
    input,
    encoding: "utf8",
  });
  return { status: run.status ?? -1, stderr: run.stderr };
}

function makeEditInput(filePath: string): string {
  return JSON.stringify({
    tool_name: "Edit",
    tool_input: { file_path: filePath },
  });
}

function readLintedFiles(): string[] {
  const log = join(root, LINT_LOG);
  if (!existsSync(log)) {
    return [];
  }
  return readFileSync(log, "utf8").trim().split("\n");
}

describe("edited-file lint hook", () => {
  it("lints the edited file alone and never blocks", () => {
    makeHookRepo();

    const result = runLintHook(makeEditInput(join(root, "src/a.ts")));

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("stub finding");
    expect(readLintedFiles()).toEqual(["src/a.ts"]);
  });

  it("lints a tsx and an mjs file", () => {
    makeHookRepo();

    runLintHook(makeEditInput(join(root, "src/b.tsx")));
    runLintHook(makeEditInput(join(root, "src/c.mjs")));

    expect(readLintedFiles()).toEqual(["src/b.tsx", "src/c.mjs"]);
  });

  it("skips other files, outside paths and unreadable input", () => {
    makeHookRepo();
    const outside = mkdtempSync(join(tmpdir(), "lint-hook-outside-"));
    writeTree(outside, { "x.ts": "export const x = 1;\n" });

    const runs = [
      runLintHook(makeEditInput(join(root, "docs/a.md"))),
      runLintHook(makeEditInput(join(outside, "x.ts"))),
      runLintHook(makeEditInput(join(root, "src/missing.ts"))),
      runLintHook(makeEditInput("../src/a.ts")),
      runLintHook("not json"),
      runLintHook(JSON.stringify({ tool_input: {} })),
    ];
    rmSync(outside, { recursive: true, force: true });

    expect(runs.map((run) => run.status)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(readLintedFiles()).toEqual([]);
  });

  it("stays quiet when oxlint is not installed", () => {
    makeHookRepo();
    rmSync(join(root, "node_modules"), { recursive: true });

    const result = runLintHook(makeEditInput(join(root, "src/a.ts")));

    expect(result).toEqual({ status: 0, stderr: "" });
  });
});
