import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Result } from "types/utils";

import type { CommandRunner, CommandSpec, GitPort } from "../src/types";

/** File contents by path relative to the temp root. */
export type Tree = Readonly<Record<string, string>>;

export interface FrontMatter {
  readonly date?: string;
  readonly breaking?: string;
  readonly security?: string;
}

const DEFAULT_FRONT_MATTER: Required<FrontMatter> = {
  date: "2026-10-03",
  breaking: "false",
  security: "false",
};

export function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "release-"));
}

export function writeTree(root: string, tree: Tree): void {
  for (const [path, content] of Object.entries(tree)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/** One notes file's text: front matter lines in the given order, then the body. */
export function makeNotesFile(frontMatter: FrontMatter, body: string): string {
  const merged = { ...DEFAULT_FRONT_MATTER, ...frontMatter };
  const lines = Object.entries(merged).map(
    ([key, value]) => `${key}: ${value}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

/** A notes dir under a temp root; returns the dir path. */
export function makeNotesDir(files: Readonly<Record<string, string>>): string {
  const root = makeTempRoot();
  const dir = join(root, "docs", "releases");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

export function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** git's stdout with the trailing newline trimmed, for a one-value read. */
export function readGitOutput(cwd: string, args: readonly string[]): string {
  const output = runGit(cwd, args);
  return output.trim();
}

export interface GitRepos {
  readonly root: string;
  readonly clone: string;
  readonly head: string;
}

/** A bare `remote.git` and a `clone` whose main holds `tree`, pushed. */
export function makeGitRepos(tree: Tree): GitRepos {
  const root = makeTempRoot();
  const remote = join(root, "remote.git");
  const clone = join(root, "clone");
  runGit(root, ["init", "--bare", "--quiet", "--initial-branch=main", remote]);
  runGit(root, ["clone", "--quiet", remote, clone]);
  runGit(clone, ["config", "user.email", "release@test"]);
  runGit(clone, ["config", "user.name", "release test"]);
  runGit(clone, ["config", "commit.gpgsign", "false"]);
  runGit(clone, ["config", "tag.gpgsign", "false"]);
  writeTree(clone, tree);
  runGit(clone, ["add", "."]);
  runGit(clone, ["commit", "--quiet", "-m", "tree"]);
  runGit(clone, ["push", "--quiet", "origin", "main"]);
  const head = runGit(clone, ["rev-parse", "HEAD"]).trim();
  return { root, clone, head };
}

/** A GitPort whose every method is inert; a test overrides the ones it reads. */
export function stubGitPort(overrides: Partial<GitPort> = {}): GitPort {
  return {
    fetchDefaultBranch: () => undefined,
    listRemoteTags: () => [],
    listPublicTags: () => [],
    commitScratchRepo: () => undefined,
    resolveCommit: () => undefined,
    isOnDefaultBranch: () => false,
    isAncestor: () => false,
    readFileAt: () => undefined,
    hasLocalTag: () => false,
    createTag: () => undefined,
    pushTag: () => undefined,
    listTrackedPaths: () => [],
    archiveTo: () => undefined,
    readCommitterDate: () => "2026-10-25T22:19:08Z",
    writeTree: () => "",
    verifyTreeMatchesDir: () => [],
    commitTree: () => "",
    writeAnnotatedTag: () => "",
    countTreeChanges: () => ({ added: 0, edited: 0, deleted: 0 }),
    fetchPublic: () => ({ tags: new Map() }),
    pushPublic: () => undefined,
    listRecords: () => ({ ok: true, value: [] }),
    pushRecord: () => undefined,
    discardScratchObjects: () => undefined,
    ...overrides,
  };
}

export interface RecordedRunner {
  readonly runner: CommandRunner;
  readonly specs: CommandSpec[];
}

/** A runner that records each spec and answers with the next queued outcome, exit 0 once they run out. */
export function stubCommandRunner(
  outcomes: readonly Result<number, string>[] = [],
  onRun?: (spec: CommandSpec) => void,
): RecordedRunner {
  const specs: CommandSpec[] = [];
  const queue = [...outcomes];
  const runner: CommandRunner = {
    run(spec) {
      specs.push(spec);
      onRun?.(spec);
      return queue.shift() ?? { ok: true, value: 0 };
    },
  };
  return { runner, specs };
}
