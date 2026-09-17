import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readLocalBrief, readLocalFileDiffs } from "./brief.server";
import { BriefErrorCodes } from "../utils/briefErrors";

const TEST_BRIEF_ID = "test-review-comments";
const OUT_DIR = resolve(process.cwd(), "../../tools/categorizer/out");
const deltaPath = resolve(OUT_DIR, `${TEST_BRIEF_ID}.delta.json`);
const commentsPath = resolve(OUT_DIR, `${TEST_BRIEF_ID}.delta.comments.json`);
const diffsPath = resolve(OUT_DIR, `${TEST_BRIEF_ID}.delta.diffs.json`);
const BOTH_NAMES_ID = "test-both-sidecar-names";
const briefDiffsPath = resolve(OUT_DIR, `${BOTH_NAMES_ID}.diffs.json`);
const deltaDiffsPath = resolve(OUT_DIR, `${BOTH_NAMES_ID}.delta.diffs.json`);
const fixturePaths = [
  deltaPath,
  commentsPath,
  diffsPath,
  briefDiffsPath,
  deltaDiffsPath,
];
const ACCORDION_PATCH = [
  "diff --git a/src/components/Accordion/Accordion.tsx b/src/components/Accordion/Accordion.tsx",
  "--- a/src/components/Accordion/Accordion.tsx",
  "+++ b/src/components/Accordion/Accordion.tsx",
  "@@ -1,1 +1,2 @@",
  '+import { useState } from "react";',
  " export {};",
].join("\n");

describe("readLocalBrief", () => {
  beforeAll(async () => {
    await mkdir(OUT_DIR, { recursive: true });
    await Promise.all([
      writeFile(
        deltaPath,
        JSON.stringify({
          pr: {
            repo: "example/repo",
            number: 1,
            title: "Test delta",
            url: "https://example.com/pull/1",
            sha: "head-sha",
            description: "",
          },
          baselineSha: "base-sha",
          headSha: "head-sha",
          summary: "Test summary",
          commentsAddressed: "Test comments addressed",
          wholePrImpact: "Test impact",
          changedGroups: [
            {
              id: "g1",
              title: "Test group",
              summary: "Test group summary",
              dominantCategory: "bugfix",
              secondaryCategories: [],
              uncertain: false,
              uncertainBetween: [],
            },
          ],
          chunks: [
            {
              id: "c1",
              changeGroupId: "g1",
              file: "src/components/Accordion/Accordion.tsx",
              concern: "implementation",
              role: "core",
              loc: { added: 1, deleted: 0 },
              addedRanges: [{ start: 1, end: 1 }],
              removedRanges: [],
              riskSurface: [],
              summary: "Test chunk summary",
              addressesComments: [],
            },
          ],
        }),
        "utf8",
      ),
      writeFile(
        commentsPath,
        JSON.stringify([
          {
            id: "3419186366",
            file: "src/components/Accordion/Accordion.tsx",
            startLine: null,
            line: null,
            originalStartLine: null,
            originalLine: 103,
            author: "example-user",
            body: "Let's make the open-close state typesafe",
            inReplyToId: null,
            outdated: true,
          },
        ]),
        "utf8",
      ),
      writeFile(
        briefDiffsPath,
        JSON.stringify([{ file: "a.ts", patch: "brief" }]),
        "utf8",
      ),
      writeFile(
        deltaDiffsPath,
        JSON.stringify([{ file: "a.ts", patch: "delta" }]),
        "utf8",
      ),
      writeFile(
        diffsPath,
        JSON.stringify([
          {
            file: "src/components/Accordion/Accordion.tsx",
            patch: ACCORDION_PATCH,
          },
        ]),
        "utf8",
      ),
    ]);
  });

  afterAll(async () => {
    await Promise.all(
      fixturePaths.map(async (fixturePath) => rm(fixturePath, { force: true })),
    );
  });

  it("hydrates review comments from a delta comments sidecar", async () => {
    const brief = await readLocalBrief(TEST_BRIEF_ID);

    expect(brief.artifactKind).toBe("delta");
    expect(brief.reviewComments).toBeDefined();
    const comments = brief.reviewComments ?? [];
    expect(comments.map((comment) => comment.id)).toContain("3419186366");
    expect(
      comments.find((comment) => comment.id === "3419186366"),
    ).toMatchObject({
      file: "src/components/Accordion/Accordion.tsx",
      line: null,
      originalLine: 103,
      body: expect.stringContaining("open-close state typesafe"),
    });
  });

  it("leaves chunks unsliced; the client slices from the patches", async () => {
    const brief = await readLocalBrief(TEST_BRIEF_ID);

    expect(brief.chunks[0]?.diff).toBeUndefined();
  });

  it("ships the diffs sidecar as per-file patches", async () => {
    const patches = await readLocalFileDiffs(TEST_BRIEF_ID);

    expect(patches).toEqual([
      {
        file: "src/components/Accordion/Accordion.tsx",
        patch: ACCORDION_PATCH,
      },
    ]);
  });

  it("reads the brief sidecar name before the delta one", async () => {
    const patches = await readLocalFileDiffs(BOTH_NAMES_ID);

    expect(patches).toEqual([{ file: "a.ts", patch: "brief" }]);
  });

  it("refuses an id with no diffs sidecar under either name", async () => {
    await expect(
      readLocalFileDiffs("no-such-diffs_1_deadbeef"),
    ).rejects.toThrow(BriefErrorCodes.UNREADABLE);
  });
});
