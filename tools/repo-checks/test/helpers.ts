import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** File contents by repo-relative path. */
export type Tree = Readonly<Record<string, string>>;

const GIT_IDENTITY = [
  "-c",
  "user.email=repo-checks@example.invalid",
  "-c",
  "user.name=repo-checks",
];

export function runGit(cwd: string, args: readonly string[]): string {
  const run = spawnSync("git", [...GIT_IDENTITY, ...args], {
    cwd,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  }
  return run.stdout;
}

export function writeTree(root: string, tree: Tree): void {
  for (const [path, content] of Object.entries(tree)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}
