import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testLogger } from "../../../../test/logging";
import {
  DELTA_ID,
  FIRST_ID,
  FIRST_SHA,
  SECOND_ID,
  SECOND_SHA,
  STEM,
  buildMarksJson,
  buildRevisionChangesJson,
  buildStoredBriefJson,
  buildStoredDeltaJson,
  makeOutDir,
  makeUnreadableArtifact,
  removeOutDirs,
  writeArtifacts,
} from "../../../../test/local-briefs-fixtures";
import { collectBriefIds, listLocalBriefSummaries } from "./summaries";

afterEach(removeOutDirs);

const log = testLogger();

async function listIn(dir: string) {
  const listed = await listLocalBriefSummaries(dir, log);
  if (!listed.ok) {
    throw new Error(`listing failed: ${listed.error.kind}`);
  }
  return listed.value;
}

describe("collectBriefIds", () => {
  it("takes one sorted id per brief or delta artifact and skips bad ids", () => {
    expect(
      collectBriefIds([
        "b.delta.json",
        "a.brief.json",
        "a.delta.json",
        "a.diffs.json",
        "bad id.brief.json",
      ]),
    ).toEqual(["a", "b"]);
  });
});

describe("listLocalBriefSummaries", () => {
  it("lists a directory that does not exist yet as empty", async () => {
    const dir = await makeOutDir();

    expect(await listIn(join(dir, "missing"))).toEqual([]);
  });

  it("summarizes brief and delta rows from their headers", async () => {
    const dir = await makeOutDir();
    await writeArtifacts(dir, {
      [`${FIRST_ID}.brief.json`]: buildStoredBriefJson(FIRST_SHA, 1, "First"),
      [`${DELTA_ID}.delta.json`]: buildStoredDeltaJson(FIRST_SHA, SECOND_SHA),
    });

    expect(await listIn(dir)).toEqual([
      {
        id: FIRST_ID,
        artifactKind: "brief",
        repo: "example/repo",
        number: 99,
        title: "First",
        sha: FIRST_SHA,
        index: 1,
      },
      {
        id: DELTA_ID,
        artifactKind: "delta",
        repo: "example/repo",
        number: 99,
        title: "Delta",
        sha: SECOND_SHA,
        baselineSha: FIRST_SHA,
        headSha: SECOND_SHA,
        baselineIndex: 1,
      },
    ]);
  });

  it("drops an invalid or unreadable artifact, never the listing", async () => {
    const dir = await makeOutDir();
    await writeArtifacts(dir, {
      [`${FIRST_ID}.brief.json`]: buildStoredBriefJson(FIRST_SHA, 1, "First"),
      "broken.brief.json": "{",
      "shapeless.delta.json": JSON.stringify({ pr: {} }),
    });
    await makeUnreadableArtifact(dir, "locked.brief.json");

    const ids = (await listIn(dir)).map((summary) => summary.id);
    expect(ids).toEqual([FIRST_ID]);
  });

  it("offers Previous Brief through a legacy revision-changes sidecar", async () => {
    const dir = await makeOutDir();
    await writeArtifacts(dir, {
      [`${FIRST_ID}.brief.json`]: buildStoredBriefJson(FIRST_SHA, 1, "First"),
      [`${SECOND_ID}.brief.json`]: buildStoredBriefJson(
        SECOND_SHA,
        2,
        "Second",
      ),
      [`${SECOND_ID}.revchanges.json`]: buildRevisionChangesJson(
        FIRST_SHA,
        SECOND_SHA,
      ),
    });

    const [first, second] = await listIn(dir);
    expect(first?.comparisons).toBeUndefined();
    expect(second?.comparisons).toEqual({
      previousBrief: {
        marksId: SECOND_ID,
        baselineSha: FIRST_SHA,
        baselineIndex: 1,
      },
    });
  });

  it("offers both comparisons from marks, with narrative and Delta ids", async () => {
    const dir = await makeOutDir();
    const previousMarksId = `${STEM}_2_previous-brief`;
    const checkpointMarksId = `${STEM}_2_checkpoint`;
    await writeArtifacts(dir, {
      [`${SECOND_ID}.brief.json`]: buildStoredBriefJson(
        SECOND_SHA,
        2,
        "Second",
      ),
      [`${SECOND_ID}.revision-narrative.json`]: "{}",
      [`${DELTA_ID}.delta.json`]: buildStoredDeltaJson(FIRST_SHA, SECOND_SHA),
      [`${previousMarksId}.comparison.json`]: buildMarksJson(
        FIRST_SHA,
        SECOND_SHA,
        "previous-brief",
        1,
      ),
      [`${checkpointMarksId}.comparison.json`]: buildMarksJson(
        FIRST_SHA,
        SECOND_SHA,
        "checkpoint",
        null,
      ),
      [`other-repo_2_x.comparison.json`]: buildMarksJson(
        FIRST_SHA,
        SECOND_SHA,
        "checkpoint",
        null,
      ),
      [`${STEM}_broken.comparison.json`]: "{",
    });

    const second = (await listIn(dir)).find((row) => row.id === SECOND_ID);
    expect(second?.comparisons).toEqual({
      previousBrief: {
        marksId: previousMarksId,
        narrativeId: SECOND_ID,
        baselineSha: FIRST_SHA,
        baselineIndex: 1,
      },
      lastReview: {
        marksId: checkpointMarksId,
        deltaId: DELTA_ID,
        baselineSha: FIRST_SHA,
        baselineIndex: null,
      },
    });
  });
});
