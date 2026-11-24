import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Result } from "types/utils";

import {
  ENV_EXAMPLE_NAME,
  ENV_FILE_NAME,
  EXEMPT_PATH_PREFIXES,
  EXEMPT_PATHS,
  PROVENANCE_PATTERNS,
} from "./consts";
import type { TrackedText } from "../types";
import type { ProvenanceHit } from "./types";

const NUL_BYTE = 0;

function isExempt(path: string): boolean {
  if (EXEMPT_PATHS.has(path)) {
    return true;
  }
  return EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Never opened: a real env file holds live keys. */
function isEnvFile(path: string): boolean {
  const name = basename(path);
  const example = name.toLowerCase() === ENV_EXAMPLE_NAME;
  return !example && ENV_FILE_NAME.test(name);
}

function findLineHits(path: string, line: string, lineNumber: number) {
  const hits: ProvenanceHit[] = [];
  for (const { kind, pattern } of PROVENANCE_PATTERNS) {
    for (const found of line.matchAll(pattern)) {
      hits.push({ path, line: lineNumber, kind, match: found[0] });
    }
  }
  return hits;
}

export function findProvenanceHits(
  files: readonly TrackedText[],
): ProvenanceHit[] {
  const hits: ProvenanceHit[] = [];
  for (const { path, text } of files) {
    if (isExempt(path) || isEnvFile(path)) {
      continue;
    }
    for (const [index, line] of text.split("\n").entries()) {
      hits.push(...findLineHits(path, line, index + 1));
    }
  }
  return hits;
}

function listTrackedPaths(root: string): Result<string[], string> {
  const run = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    return { ok: false, error: `git ls-files failed: ${run.stderr.trim()}` };
  }
  const paths = run.stdout.split("\0").filter((path) => path.length > 0);
  return { ok: true, value: paths };
}

/**
 * The working-tree text of a tracked path, or undefined when deleted, binary
 * or not a regular file: a link is never followed, so it cannot reach an env
 * file under another name.
 */
function readTrackedText(root: string, path: string): string | undefined {
  const file = join(root, path);
  let bytes: Buffer;
  try {
    if (!lstatSync(file).isFile()) {
      return undefined;
    }
    bytes = readFileSync(file);
  } catch {
    return undefined;
  }
  if (bytes.includes(NUL_BYTE)) {
    return undefined;
  }
  return bytes.toString("utf8");
}

/** Every provenance citation in the tracked files of the work tree at `root`. */
export function checkProvenance(root: string): Result<ProvenanceHit[], string> {
  const paths = listTrackedPaths(root);
  if (!paths.ok) {
    return paths;
  }

  const files: TrackedText[] = [];
  for (const path of paths.value) {
    if (isExempt(path) || isEnvFile(path)) {
      continue;
    }
    const text = readTrackedText(root, path);
    if (text !== undefined) {
      files.push({ path, text });
    }
  }
  return { ok: true, value: findProvenanceHits(files) };
}
