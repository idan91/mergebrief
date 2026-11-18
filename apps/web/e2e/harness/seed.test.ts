import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBriefForWrite, type ArtifactIssue } from "brief-core/artifact";
import { COMMITTED_BRIEF_SUFFIX } from "ingest-briefs/testing";
import { describe, expect, it } from "vitest";
import { FIXTURE_BASE_SHA } from "../fixtures/ids";
import {
  INBOX_BEHIND_ROW,
  INBOX_INSTALLATIONS,
  INBOX_ROWS,
} from "../fixtures/inbox";
import { E2E_REPO_SLUG } from "./env";
import { buildSeedBrief } from "./seed-brief";

const FIXTURE_BRIEFS_DIR = fileURLToPath(
  new URL("../fixtures/briefs", import.meta.url),
);
const SEED_HEAD_INDEX = 2;
const SEED_COMMIT_COUNT = 2;

function listWriteIssues(body: unknown): readonly ArtifactIssue[] {
  const checked = checkBriefForWrite(body, []);
  return checked.ok ? [] : checked.error;
}

function findRepoSlug(repoId: number): string {
  const repos = INBOX_INSTALLATIONS.flatMap(
    (installation) => installation.repos,
  );
  const slug = repos.find((repo) => repo.id === repoId)?.slug;
  if (slug === undefined) {
    throw new Error(`no fixture repo ${String(repoId)}`);
  }
  return slug;
}

describe("e2e seed briefs", () => {
  it("passes the write check for every committed fixture brief", () => {
    const names = readdirSync(FIXTURE_BRIEFS_DIR).filter((name) =>
      name.endsWith(COMMITTED_BRIEF_SUFFIX),
    );
    expect(names.toSorted()).toEqual([
      "mergebrief-e2e-fixture-1_1_11111111-brief.json",
      "mergebrief-e2e-fixture-1_2_22222222-brief.json",
    ]);

    for (const name of names) {
      const text = readFileSync(join(FIXTURE_BRIEFS_DIR, name), "utf8");
      const body: unknown = JSON.parse(text);
      expect({ name, issues: listWriteIssues(body) }).toEqual({
        name,
        issues: [],
      });
    }
  });

  it("passes the write check for every inbox seed brief", () => {
    const pullRequests = [
      ...INBOX_ROWS.map((row) => ({
        repoSlug: findRepoSlug(row.repoId),
        prNumber: row.prNumber,
        title: row.title,
      })),
      {
        repoSlug: E2E_REPO_SLUG,
        prNumber: INBOX_BEHIND_ROW.prNumber,
        title: INBOX_BEHIND_ROW.title,
      },
    ];

    for (const pullRequest of pullRequests) {
      const body = buildSeedBrief({
        ...pullRequest,
        baseSha: FIXTURE_BASE_SHA,
        headSha: INBOX_BEHIND_ROW.briefHead,
        headIndex: SEED_HEAD_INDEX,
        commitCount: SEED_COMMIT_COUNT,
      });
      expect(listWriteIssues(body)).toEqual([]);
    }
  });
});
