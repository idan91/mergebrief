// The highest brief revision this machine read per PR, so a later command can
// tell what the reviewer has seen (`<cacheDir>/<profile>/read-revisions.json`).
// A read leaves no trace on the server. Cache rules hold: safe to delete, and
// a corrupt file reads as nothing read.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";

const READ_REVISIONS_FILE = "read-revisions.json";

const readRevisionsSchema = z.record(z.string(), z.number().int().positive());

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

function readRecords(cache: ProfileCache): Record<string, number> {
  try {
    const parsed = readRevisionsSchema.safeParse(
      JSON.parse(readFileSync(getFilePath(cache), "utf8")),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function readLastRevision(
  cache: ProfileCache,
  address: PullRequestAddress,
): number | undefined {
  return readRecords(cache)[getRecordKey(address)];
}

export function saveLastRevision(
  cache: ProfileCache,
  address: PullRequestAddress,
  headIndex: number,
): void {
  const records = readRecords(cache);
  const key = getRecordKey(address);
  records[key] = headIndex;
  try {
    mkdirSync(join(cache.cacheDir, cache.profileName), { recursive: true });
    writeFileSync(getFilePath(cache), JSON.stringify(records));
  } catch {
    // The read already succeeded. Without a record the next command takes the
    // no-record path, which never lands on code the reviewer did not choose.
  }
}

/** A profile moved to another instance: its numbers named the old one's PRs. */
export function clearReadRevisions(
  cacheDir: string,
  profileName: string,
): void {
  rmSync(getFilePath({ cacheDir, profileName }), { force: true });
}
