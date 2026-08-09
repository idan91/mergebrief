import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";

/**
 * Per-PR brief manifest: head SHA → PR-global brief ordinal, in first-seen
 * order. The CLI's stand-in for the product DB — a re-run reuses a known SHA's
 * index and a new SHA takes the next ordinal, with no real state held here.
 * Lives beside the artifacts as `out/<repo>-<num>.briefs.json`.
 */
const ManifestSchema = z.record(z.string(), z.number().int());
type Manifest = z.infer<typeof ManifestSchema>;

function manifestPath(outDir: string, stem: string): string {
  return join(outDir, `${stem}.briefs.json`);
}

async function load(path: string): Promise<Manifest> {
  try {
    return ManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    // Missing or unreadable manifest → start fresh. A re-run will re-key by SHA.
    return {};
  }
}

/**
 * Look up the brief index for a SHA without assigning one — `null` if that SHA
 * was never briefed. Annotates a delta with its endpoint brief indices when both
 * ends have briefs; a missing end falls back to the SHA.
 */
export async function lookupBriefIndex(
  outDir: string,
  stem: string,
  sha: string,
): Promise<number | null> {
  const manifest = await load(manifestPath(outDir, stem));
  return manifest[sha] ?? null;
}

/**
 * Reverse lookup: the head SHA assigned to a given brief index, or `null` if no
 * brief holds that index — used to find a brief's previous head (index − 1).
 */
export async function lookupBriefShaByIndex(
  outDir: string,
  stem: string,
  index: number,
): Promise<string | null> {
  const manifest = await load(manifestPath(outDir, stem));
  for (const [sha, i] of Object.entries(manifest)) {
    if (i === index) return sha;
  }
  return null;
}

/**
 * Assign (or look up) the PR-global brief index for a head SHA, persisting the
 * manifest. A known SHA returns its existing index (idempotent re-run); a new
 * SHA takes max+1. `stem` is `<owner>-<repo>-<number>`.
 */
export async function assignBriefIndex(
  outDir: string,
  stem: string,
  headSha: string,
): Promise<number> {
  await mkdir(outDir, { recursive: true });
  const path = manifestPath(outDir, stem);
  const manifest = await load(path);
  const existing = manifest[headSha];
  if (existing != null) return existing;
  const next = Math.max(0, ...Object.values(manifest)) + 1;
  manifest[headSha] = next;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return next;
}
