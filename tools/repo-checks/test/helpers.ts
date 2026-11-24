import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** File contents by repo-relative path. */
export type Tree = Readonly<Record<string, string>>;

export function writeTree(root: string, tree: Tree): void {
  for (const [path, content] of Object.entries(tree)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}
