import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Writes `files` (relative path to content) under a fresh temp dir and returns its path. */
export function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "docs-site-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  return root;
}
