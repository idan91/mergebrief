import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PullRequestRow } from "persistence";

/** The map key a PR is held under while the directory is being mapped. */
export function buildPrKey(slug: string, prNumber: number): string {
  return `${slug}#${String(prNumber)}`;
}

/** A malformed artifact stops the run: a partial ingest of a corrupt
 * directory would be harder to notice than a loud stop. */
export function throwFileError(name: string, detail: string): never {
  throw new Error(`${name}: ${detail}`);
}

export async function readJsonFile(
  dir: string,
  name: string,
): Promise<unknown> {
  const body = await readFile(join(dir, name), "utf8");
  try {
    return JSON.parse(body);
  } catch {
    return throwFileError(name, "not valid JSON");
  }
}

/** The CLI's stem for a row: `owner-repo-number` with `/` flattened. */
export function buildStem(row: PullRequestRow): string | undefined {
  const slug = row.repoSlug;
  if (slug === null) {
    return undefined;
  }
  return `${slug.replace(/\//g, "-")}-${String(row.prNumber)}`;
}

/**
 * Stem → its row, or `null` where the stem is AMBIGUOUS: flattening `/` makes
 * `a-b/c` #1 and `a/b-c` #1 both `a-b-c-1`, and attaching a sidecar to a
 * guess would put one PR's marks on another's brief.
 */
export function buildStemIndex(
  prRows: ReadonlyMap<string, PullRequestRow>,
): Map<string, PullRequestRow | null> {
  const index = new Map<string, PullRequestRow | null>();
  for (const row of prRows.values()) {
    const stem = buildStem(row);
    if (stem === undefined) {
      continue;
    }
    index.set(stem, index.has(stem) ? null : row);
  }
  return index;
}

/** The `_<index>_` a CLI artifact file name carries; `undefined` if unusable. */
export function parseHeadIndex(
  match: RegExpExecArray | null,
): number | undefined {
  const raw = match?.groups?.["index"];
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** The row a sidecar's stem names, or the reason it cannot be placed. */
export function resolveStemRow(
  index: ReadonlyMap<string, PullRequestRow | null>,
  stem: string | undefined,
): { ok: true; row: PullRequestRow } | { ok: false; reason: string } {
  const row = stem === undefined ? undefined : index.get(stem);
  if (row === undefined) {
    return { ok: false, reason: "no ingested pull request for its stem" };
  }
  if (row === null) {
    return {
      ok: false,
      reason: `stem ${stem ?? ""} matches more than one ingested pull request`,
    };
  }
  return { ok: true, row };
}
