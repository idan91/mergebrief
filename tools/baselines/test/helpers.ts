import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** File contents by repo-relative path. */
export type Tree = Readonly<Record<string, string>>;

const GIT_IDENTITY = [
  "-c",
  "user.email=baselines@example.invalid",
  "-c",
  "user.name=baselines",
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

export function stubSuppressions(
  entries: Readonly<Record<string, Readonly<Record<string, number>>>>,
): string {
  const shaped: Record<string, Record<string, { count: number }>> = {};
  for (const [path, rules] of Object.entries(entries)) {
    const counts: Record<string, { count: number }> = {};
    for (const [rule, count] of Object.entries(rules)) counts[rule] = { count };
    shaped[path] = counts;
  }
  return `${JSON.stringify(shaped, null, 2)}\n`;
}

export function stubRecords(
  records: readonly { from: string; to: string; rule: string }[],
): string {
  const shaped = records.map((record) => ({
    type: "dependency",
    from: record.from,
    to: record.to,
    dependencyTypes: ["local"],
    rule: { severity: "error", name: record.rule },
  }));
  return `${JSON.stringify(shaped, null, 2)}\n`;
}

export const LINT_CONFIG_WITH_RULES = JSON.stringify(
  { rules: { "house/no-em-dash": "error", "house/test-title": "error" } },
  null,
  2,
);

export function stubManifest(lint: string): string {
  return `${JSON.stringify({ name: "stub", scripts: { lint } }, null, 2)}\n`;
}

export interface Checkout {
  readonly root: string;
  dispose(): void;
}

/** A throwaway repository with `base` committed on `main`, then `head` applied. */
export function makeCheckout(base: Tree, head?: Tree): Checkout {
  const root = mkdtempSync(join(tmpdir(), "baselines-"));
  runGit(root, ["init", "-b", "main"]);
  writeTree(root, base);
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-m", "base"]);
  if (head !== undefined) writeTree(root, head);
  return {
    root,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Node's own remove and rename: the gate must see a real tree change. */
export function removeFile(root: string, path: string): void {
  rmSync(join(root, path));
}

export function renameFile(root: string, from: string, to: string): void {
  const target = join(root, to);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(join(root, from), target);
}
