import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listLocalBriefs, readComparisonMarks } from "./brief.server";

const OUT_DIR = resolve(process.cwd(), "../../tools/categorizer/out");
const STEM = "legacyalias-fixture";
const FIRST_SHA = "aaaaaaaa1111111111111111111111111111111";
const SECOND_SHA = "bbbbbbbb2222222222222222222222222222222";
const FIRST_ID = `${STEM}_1_${FIRST_SHA.slice(0, 8)}`;
const SECOND_ID = `${STEM}_2_${SECOND_SHA.slice(0, 8)}`;

const firstBriefPath = resolve(OUT_DIR, `${FIRST_ID}.brief.json`);
const secondBriefPath = resolve(OUT_DIR, `${SECOND_ID}.brief.json`);
const revchangesPath = resolve(OUT_DIR, `${SECOND_ID}.revchanges.json`);
const fixturePaths = [firstBriefPath, secondBriefPath, revchangesPath];

function briefFixture(sha: string, index: number, title: string) {
  return JSON.stringify({
    pr: {
      repo: "example/legacyalias",
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

/**
 * Migration coverage: a brief whose head has only a legacy `.revchanges.json` — no `.comparison.json` —
 * still offers the Previous Brief comparison. Mirrors the real local demo
 * effect: Brief _2 gains Previous Brief once its `.comparison.json` sibling
 * hasn't been (re)generated.
 */
describe("legacy .revchanges.json as a Previous Brief marks alias", () => {
  beforeAll(async () => {
    await mkdir(OUT_DIR, { recursive: true });
    await Promise.all([
      writeFile(firstBriefPath, briefFixture(FIRST_SHA, 1, "First"), "utf8"),
      writeFile(secondBriefPath, briefFixture(SECOND_SHA, 2, "Second"), "utf8"),
      writeFile(
        revchangesPath,
        JSON.stringify({
          headSha: SECOND_SHA,
          prevHeadSha: FIRST_SHA,
          prevIndex: 1,
          files: [
            {
              file: "src/a.ts",
              addedRanges: [{ start: 1, end: 2 }],
              removedRanges: [],
            },
          ],
        }),
        "utf8",
      ),
    ]);
  });

  afterAll(async () => {
    await Promise.all(
      fixturePaths.map((fixturePath) => rm(fixturePath, { force: true })),
    );
  });

  it("offers Previous Brief on the second brief via the legacy sidecar", async () => {
    const summaries = await listLocalBriefs();
    const second = summaries.find((summary) => summary.id === SECOND_ID);
    expect(second?.comparisons?.previousBrief).toEqual({
      marksId: SECOND_ID,
      baselineSha: FIRST_SHA,
      baselineIndex: 1,
    });
  });

  it("does not offer Previous Brief on the first brief (no revision to compare against)", async () => {
    const summaries = await listLocalBriefs();
    const first = summaries.find((summary) => summary.id === FIRST_ID);
    expect(first?.comparisons?.previousBrief).toBeUndefined();
  });

  it("readComparisonMarks maps the legacy sidecar onto ComparisonMarks", async () => {
    const marks = await readComparisonMarks(SECOND_ID);
    expect(marks).toEqual({
      baselineSha: FIRST_SHA,
      headSha: SECOND_SHA,
      baselineLabel: "previous-brief",
      baselineIndex: 1,
      files: [
        {
          file: "src/a.ts",
          addedRanges: [{ start: 1, end: 2 }],
          removedRanges: [],
        },
      ],
    });
  });
});
