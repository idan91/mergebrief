// The span of the highest brief revision this machine read per PR, so a later
// command can tell what the reviewer has seen
// (`<cacheDir>/<profile>/read-revisions.json`). A read leaves no trace on the
// server. A span rather than a revision number: a purged and regenerated PR
// reuses its numbers on other commits. Rather than a head alone: a retarget is
// a new revision on the same head. Cache rules hold: safe to delete, and a
// corrupt file reads as nothing read.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import type { BriefSpan } from "../types";

const READ_REVISIONS_FILE = "read-revisions.json";

const readRevisionsSchema = z.record(
  z.string(),
  z.object({ base: z.string(), head: z.string() }),
) satisfies z.ZodType<Record<string, BriefSpan>>;

export interface ProfileCache {
  readonly cacheDir: string;
  readonly profileName: string;
}

export interface PullRequestAddress {
  readonly repoId: string;
  readonly prNumber: number;
}

function getFilePath(cache: ProfileCache): string {
  return join(cache.cacheDir, cache.profileName, READ_REVISIONS_FILE);
}

function getRecordKey(address: PullRequestAddress): string {
  return `${address.repoId}#${address.prNumber}`;
}

function readRecords(cache: ProfileCache): Record<string, BriefSpan> {
  try {
    const parsed = readRevisionsSchema.safeParse(
      JSON.parse(readFileSync(getFilePath(cache), "utf8")),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function readLastSpan(
  cache: ProfileCache,
  address: PullRequestAddress,
): BriefSpan | undefined {
  return readRecords(cache)[getRecordKey(address)];
}

export function saveLastSpan(
  cache: ProfileCache,
  address: PullRequestAddress,
  span: BriefSpan,
): void {
  const records = readRecords(cache);
  records[getRecordKey(address)] = span;
  try {
    mkdirSync(join(cache.cacheDir, cache.profileName), { recursive: true });
    writeFileSync(getFilePath(cache), JSON.stringify(records));
  } catch {
    // The read already succeeded. Without a record the next command takes the
    // no-record path, which never lands on code the reviewer did not choose.
  }
}

/** A profile moved to another instance: its spans named the old one's PRs. */
export function clearReadRevisions(
  cacheDir: string,
  profileName: string,
): void {
  rmSync(getFilePath({ cacheDir, profileName }), { force: true });
}
