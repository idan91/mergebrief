import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { writeJournal } from "../../scripts/squash/logic/write-meta";
import type { Journal, JournalEntry } from "../../scripts/squash/types";

export const CREATE_FIRST = "CREATE TABLE public.first (id integer);";
export const CREATE_SECOND = "CREATE TABLE public.second (id integer);";

export const CHAIN_TIP: JournalEntry = {
  idx: 1,
  version: "7",
  when: 2000,
  tag: "0001_second",
  breakpoints: true,
};

export const CHAIN_JOURNAL: Journal = {
  version: "7",
  dialect: "postgresql",
  entries: [
    { idx: 0, version: "7", when: 1000, tag: "0000_first", breakpoints: true },
    CHAIN_TIP,
  ],
};

/** A fresh temp dir removed when the calling test finishes. */
export function makeScratchDir(prefix: string): string {
  const template = join(tmpdir(), prefix);
  const dir = mkdtempSync(template);
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A two-entry `drizzle/` folder: SQL, journal and one snapshot per entry. */
export function writeChainFixture(dir: string): void {
  const meta = join(dir, "meta");
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(dir, "0000_first.sql"), CREATE_FIRST);
  writeFileSync(join(dir, "0001_second.sql"), CREATE_SECOND);
  writeFileSync(join(meta, "0000_snapshot.json"), "{}");
  writeFileSync(join(meta, "0001_snapshot.json"), "{}");
  writeJournal(dir, CHAIN_JOURNAL);
}
