// Out-dir artifacts for the local Brief suites: minimal bodies the
// brief-core readers accept, written into a throwaway directory.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIRST_SHA = "aaaaaaaa11111111111111111111111111111111";
export const SECOND_SHA = "bbbbbbbb22222222222222222222222222222222";
export const STEM = "example-repo-99";
export const FIRST_ID = `${STEM}_1_${FIRST_SHA.slice(0, 8)}`;
export const SECOND_ID = `${STEM}_2_${SECOND_SHA.slice(0, 8)}`;
export const DELTA_ID = `${STEM}_delta_${SECOND_SHA.slice(0, 8)}`;

export function buildStoredBriefJson(
  sha: string,
  index: number,
  title: string,
): string {
  return JSON.stringify({
    pr: {
      repo: "example/repo",
      number: 99,
      title,
      url: "https://example.com/pull/99",
      sha,
      description: "",
    },
    summary: `Summary for ${title}`,
    index,
    changeGroups: [],
    chunks: [],
    concernView: [],
  });
}

export function buildStoredDeltaJson(
  baselineSha: string,
  headSha: string,
): string {
  return JSON.stringify({
    pr: {
      repo: "example/repo",
      number: 99,
      title: "Delta",
      url: "https://example.com/pull/99",
      sha: headSha,
      description: "",
    },
    baselineSha,
    headSha,
    baselineIndex: 1,
    headIndex: null,
    generation: { provider: "anthropic", model: "m", effort: null },
    summary: "Delta summary",
    commentsAddressed: "",
    wholePrImpact: "",
    changedGroups: [],
    chunks: [],
  });
}

/** The span's skip or no-change record a delta file may hold instead of a Delta Brief. */
export function buildDeltaRecordJson(
  artifactKind: "deltaSkipped" | "deltaUnchanged",
  baselineSha: string,
  headSha: string,
): string {
  const record: Record<string, unknown> = {
    artifactKind,
    pr: {
      repo: "example/repo",
      number: 99,
      title: "Delta",
      url: "https://example.com/pull/99",
      sha: headSha,
      description: "",
    },
    baselineSha,
    headSha,
    baselineIndex: null,
    headIndex: 2,
  };
  if (artifactKind === "deltaSkipped") {
    record["skipped"] = "span-too-large";
  }
  return JSON.stringify(record);
}

export const REVIEW_COMMENTS = [
  {
    id: "3419186366",
    file: "src/a.ts",
    startLine: null,
    line: null,
    originalStartLine: null,
    originalLine: 103,
    author: "example-user",
    body: "Make the state typesafe",
    inReplyToId: null,
    outdated: true,
  },
];

export const MARKS_FILES = [
  { file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] },
];

export function buildMarksJson(
  baselineSha: string,
  headSha: string,
  baselineLabel: string,
  baselineIndex: number | null,
): string {
  return JSON.stringify({
    baselineSha,
    headSha,
    baselineLabel,
    baselineIndex,
    files: MARKS_FILES,
  });
}

export function buildRevisionChangesJson(
  prevHeadSha: string,
  headSha: string,
): string {
  return JSON.stringify({
    headSha,
    prevHeadSha,
    prevIndex: 1,
    files: MARKS_FILES,
  });
}

const createdDirs: string[] = [];

export async function makeOutDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "local-briefs-"));
  createdDirs.push(dir);
  return dir;
}

export async function removeOutDirs(): Promise<void> {
  const dirs = createdDirs.splice(0);
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
}

export async function writeArtifacts(
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const writes = Object.entries(files).map(([name, text]) =>
    writeFile(join(dir, name), text, "utf8"),
  );
  await Promise.all(writes);
}

/** A directory where a file is expected: the read fails with EISDIR. */
export async function makeUnreadableArtifact(
  dir: string,
  name: string,
): Promise<void> {
  await mkdir(join(dir, name));
}
