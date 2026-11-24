import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGit, writeTree } from "./helpers";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const HOOKS_DIR = join(REPO_ROOT, ".githooks");
const LINT_LOG = "oxlint-args.log";
const HOOK_FILES = ["install.sh", "pre-push", "commit-msg"];
const MARKER = "post-checkout-ran";
// The branch-name rule binds pushes to this repository only; a path ending in
// its slug stands in for the GitHub remote.
const ORIGIN = "idan91/code-review.git";

// Stands in for oxlint: records the files it was handed, one per line, and
// fails when any of them contains the word FAIL_LINT.
const OXLINT_STUB = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    -*) ;;
    *) printf '%s\\n' "$arg" >> "${LINT_LOG}"; grep -q FAIL_LINT "$arg" && failed=1 ;;
  esac
done
exit "\${failed:-0}"
`;

interface PushResult {
  readonly status: number;
  readonly stderr: string;
}

let root = "";
let work = "";

/** The tracked hook folder, as a checkout carries it. */
function copyHooks(target: string): void {
  mkdirSync(join(target, ".githooks"));
  for (const file of HOOK_FILES) {
    copyFileSync(join(HOOKS_DIR, file), join(target, ".githooks", file));
    chmodSync(join(target, ".githooks", file), 0o755);
  }
}

function readPrepareScript(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  );
  const prepare = (manifest as { scripts: { prepare: string } }).scripts
    .prepare;
  return prepare;
}

function runPrepare(cwd: string, path?: string): number {
  const env = path === undefined ? process.env : { ...process.env, PATH: path };
  const run = spawnSync("/bin/sh", ["-c", readPrepareScript()], { cwd, env });
  return run.status ?? -1;
}

function makeWorkRepo(): void {
  root = mkdtempSync(join(tmpdir(), "pre-push-"));
  work = join(root, "work");
  mkdirSync(join(root, "idan91"));
  runGit(root, ["init", "-q", "--bare", ORIGIN]);
  runGit(root, ["init", "-q", "--bare", "fork.git"]);
  runGit(root, ["init", "-q", "-b", "main", "work"]);
  runGit(work, ["remote", "add", "origin", join(root, ORIGIN)]);
  runGit(work, ["remote", "add", "fork", join(root, "fork.git")]);

  copyHooks(work);
  writeTree(work, {
    ".gitignore": `node_modules/\n${LINT_LOG}\n`,
    "node_modules/.bin/oxlint": OXLINT_STUB,
    "src/base.ts": "export const base = 1;\n",
  });
  chmodSync(join(work, "node_modules/.bin/oxlint"), 0o755);
  runGit(work, ["add", "-A"]);
  runGit(work, ["commit", "-q", "-m", "seed"]);
  expect(runPrepare(work)).toBe(0);
  runGit(work, ["push", "-q", "origin", "main"]);
  rmSync(join(work, LINT_LOG), { force: true });
}

function commitOnBranch(
  branch: string,
  files: Readonly<Record<string, string>>,
) {
  runGit(work, ["switch", "-q", "-c", branch, "main"]);
  writeTree(work, files);
  runGit(work, ["add", "-A"]);
  runGit(work, ["commit", "-q", "-m", "change"]);
}

function push(args: readonly string[], remote = "origin"): PushResult {
  const run = spawnSync("git", ["push", "-q", remote, ...args], {
    cwd: work,
    encoding: "utf8",
  });
  return { status: run.status ?? -1, stderr: run.stderr };
}

function readLintedFiles(): string[] {
  const log = join(work, LINT_LOG);
  if (!existsSync(log)) {
    return [];
  }
  return readFileSync(log, "utf8").trim().split("\n");
}

function hasRemoteBranch(branch: string): boolean {
  const run = spawnSync(
    "git",
    ["rev-parse", "--verify", "-q", `refs/heads/${branch}`],
    {
      cwd: join(root, ORIGIN),
    },
  );
  return run.status === 0;
}

beforeEach(() => {
  makeWorkRepo();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("prepare script", () => {
  let scratch = "";

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("installs the shipped hooks under the git directory", () => {
    const hooksPath = runGit(work, ["config", "core.hooksPath"]).trim();

    expect(hooksPath).toMatch(/\/\.git\/managed-hooks$/);
    expect(readdirSync(hooksPath).toSorted()).toEqual([
      "commit-msg",
      "pre-push",
    ]);
  });

  it("never runs hook code a checked-out ref carries", () => {
    commitOnBranch("chore/BRIEF-4/1-hostile", {
      ".githooks/pre-push": "#!/bin/sh\nexit 1\n",
      ".githooks/post-checkout": `#!/bin/sh\ntouch "${MARKER}"\n`,
    });
    chmodSync(join(work, ".githooks/post-checkout"), 0o755);
    runGit(work, ["add", "-A"]);
    runGit(work, ["commit", "-q", "-m", "hooks"]);
    runGit(work, ["switch", "-q", "main"]);
    runGit(work, ["switch", "-q", "chore/BRIEF-4/1-hostile"]);

    expect(existsSync(join(work, MARKER))).toBe(false);
    expect(push(["HEAD"]).status).toBe(0);
  });

  it("succeeds outside a work tree and without git", () => {
    scratch = mkdtempSync(join(tmpdir(), "prepare-"));
    copyHooks(scratch);

    expect(runPrepare(scratch)).toBe(0);
    expect(runPrepare(scratch, "/nonexistent")).toBe(0);
  });
});

describe("pre-push branch names", () => {
  it("rejects a branch outside the ticket shape", () => {
    commitOnBranch("t3/some-thread", { "src/a.ts": "export const a = 1;\n" });

    const result = push(["HEAD:refs/heads/t3/some-thread"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("t3/some-thread");
    expect(hasRemoteBranch("t3/some-thread")).toBe(false);
  });

  it("pushes a ticket branch, main and an assets branch", () => {
    commitOnBranch("chore/BRIEF-1/2a-tidy-up", {
      "src/a.ts": "export const a = 1;\n",
    });

    expect(push(["HEAD"]).status).toBe(0);
    expect(push(["HEAD:refs/heads/assets/screens"]).status).toBe(0);
    expect(push(["main"]).status).toBe(0);
    expect(hasRemoteBranch("chore/BRIEF-1/2a-tidy-up")).toBe(true);
  });

  it("leaves branch names on a fork to the fork", () => {
    commitOnBranch("t3/some-thread", { "src/a.ts": "export const a = 1;\n" });

    expect(push(["HEAD"], "fork").status).toBe(0);
  });

  it("lets a badly named remote branch be deleted", () => {
    commitOnBranch("chore/BRIEF-1/1-x", {
      "src/a.ts": "export const a = 1;\n",
    });
    expect(push(["--no-verify", "HEAD:refs/heads/old-name"]).status).toBe(0);

    expect(push([":refs/heads/old-name"]).status).toBe(0);
    expect(hasRemoteBranch("old-name")).toBe(false);
  });
});

describe("pre-push lint", () => {
  it("lints only the files changed since origin/main", () => {
    commitOnBranch("fix/BRIEF-2/1-scope", {
      "src/a.ts": "export const a = 1;\n",
      "docs/a.md": "# notes\n",
    });

    expect(push(["HEAD"]).status).toBe(0);
    expect(readLintedFiles()).toEqual(["src/a.ts"]);
  });

  it("blocks the push when a changed file fails lint", () => {
    commitOnBranch("fix/BRIEF-2/2-bad", {
      "src/a.ts": "export const a = 1; // FAIL_LINT\n",
    });

    const result = push(["HEAD"]);

    expect(result.status).not.toBe(0);
    expect(hasRemoteBranch("fix/BRIEF-2/2-bad")).toBe(false);
  });

  it("skips lint when the branch changes the lint config or plugin", () => {
    commitOnBranch("chore/BRIEF-5/1-rules", {
      ".oxlintrc.json": "{}\n",
      "tools/oxlint-plugin-house/src/index.mjs": "export {};\n",
      "src/a.ts": "export const a = 1; // FAIL_LINT\n",
    });

    const result = push(["HEAD"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("lint skipped");
    expect(readLintedFiles()).toEqual([]);
  });

  it("never runs a whole-repo lint when nothing lintable changed", () => {
    commitOnBranch("docs/BRIEF-3/1-words", { "docs/a.md": "# notes\n" });

    expect(push(["HEAD"]).status).toBe(0);
    expect(readLintedFiles()).toEqual([]);
  });
});

describe("hook delegation", () => {
  it("still runs a local commit-msg hook from the git directory", () => {
    const localHook = join(work, ".git", "hooks", "commit-msg");
    writeFileSync(localHook, '#!/bin/sh\nprintf "local\\n" >> "$1"\n');
    chmodSync(localHook, 0o755);
    writeTree(work, { "src/b.ts": "export const b = 2;\n" });
    runGit(work, ["add", "-A"]);
    runGit(work, ["commit", "-q", "-m", "subject"]);

    expect(runGit(work, ["log", "-1", "--format=%B"])).toContain("local");
  });
});
