import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testLogger } from "../../../../test/logging";
import {
  DELTA_ID,
  FIRST_ID,
  FIRST_SHA,
  MARKS_FILES,
  REVIEW_COMMENTS,
  SECOND_ID,
  SECOND_SHA,
  buildMarksJson,
  buildRevisionChangesJson,
  buildStoredBriefJson,
  buildStoredDeltaJson,
  makeOutDir,
  makeUnreadableArtifact,
  removeOutDirs,
  writeArtifacts,
} from "../../../../test/local-briefs-fixtures";
import {
  readBriefView,
  readComparisonMarksSidecar,
  readDiffsSidecar,
  readRevisionNarrativeSidecar,
} from "./artifact-reads";

const log = testLogger();
const NOT_FOUND = { ok: false, error: { kind: "not-found" } };
const UNREADABLE = { ok: false, error: { kind: "unreadable" } };

let dir: string;

beforeEach(async () => {
  dir = await makeOutDir();
});

afterEach(removeOutDirs);

describe("readBriefView", () => {
  it("serves a Delta body with its comments sidecar, unparsed", async () => {
    const delta = buildStoredDeltaJson(FIRST_SHA, SECOND_SHA);
    await writeArtifacts(dir, {
      [`${DELTA_ID}.delta.json`]: delta,
      [`${DELTA_ID}.delta.comments.json`]: JSON.stringify(REVIEW_COMMENTS),
    });

    expect(await readBriefView(dir, DELTA_ID, log)).toEqual({
      ok: true,
      value: {
        artifactKind: "delta",
        body: JSON.parse(delta),
        reviewComments: REVIEW_COMMENTS,
      },
    });
  });

  it("prefers the full Brief and omits absent comments", async () => {
    const brief = buildStoredBriefJson(FIRST_SHA, 1, "First");
    await writeArtifacts(dir, {
      [`${FIRST_ID}.brief.json`]: brief,
      [`${FIRST_ID}.delta.json`]: buildStoredDeltaJson(FIRST_SHA, SECOND_SHA),
      [`${FIRST_ID}.delta.comments.json`]: "[]",
    });

    expect(await readBriefView(dir, FIRST_ID, log)).toEqual({
      ok: true,
      value: { artifactKind: "brief", body: JSON.parse(brief) },
    });
  });

  it("answers not-found when neither artifact exists", async () => {
    expect(await readBriefView(dir, FIRST_ID, log)).toEqual(NOT_FOUND);
  });

  it("refuses a body or comments sidecar that is not JSON", async () => {
    await writeArtifacts(dir, {
      [`${FIRST_ID}.brief.json`]: "{",
      [`${SECOND_ID}.brief.json`]: buildStoredBriefJson(SECOND_SHA, 2, "B"),
      [`${SECOND_ID}.comments.json`]: "[",
    });

    expect(await readBriefView(dir, FIRST_ID, log)).toEqual(UNREADABLE);
    expect(await readBriefView(dir, SECOND_ID, log)).toEqual(UNREADABLE);
  });

  it("refuses an artifact the process cannot read", async () => {
    await makeUnreadableArtifact(dir, `${FIRST_ID}.brief.json`);

    expect(await readBriefView(dir, FIRST_ID, log)).toEqual(UNREADABLE);
  });
});

describe("readDiffsSidecar", () => {
  it("reads the Brief sidecar name before the Delta one", async () => {
    await writeArtifacts(dir, {
      [`${FIRST_ID}.diffs.json`]: "brief",
      [`${FIRST_ID}.delta.diffs.json`]: "delta",
      [`${DELTA_ID}.delta.diffs.json`]: "delta only",
    });

    expect(await readDiffsSidecar(dir, FIRST_ID, log)).toEqual({
      ok: true,
      value: "brief",
    });
    expect(await readDiffsSidecar(dir, DELTA_ID, log)).toEqual({
      ok: true,
      value: "delta only",
    });
  });

  it("answers not-found under neither name, unreadable on a read error", async () => {
    await makeUnreadableArtifact(dir, `${SECOND_ID}.diffs.json`);

    expect(await readDiffsSidecar(dir, FIRST_ID, log)).toEqual(NOT_FOUND);
    expect(await readDiffsSidecar(dir, SECOND_ID, log)).toEqual(UNREADABLE);
  });
});

describe("readComparisonMarksSidecar", () => {
  it("serves a marks sidecar verbatim", async () => {
    const marks = buildMarksJson(FIRST_SHA, SECOND_SHA, "checkpoint", null);
    await writeArtifacts(dir, { [`${SECOND_ID}.comparison.json`]: marks });

    expect(await readComparisonMarksSidecar(dir, SECOND_ID, log)).toEqual({
      ok: true,
      value: marks,
    });
  });

  it("maps a legacy revision-changes sidecar onto the marks shape", async () => {
    await writeArtifacts(dir, {
      [`${SECOND_ID}.revchanges.json`]: buildRevisionChangesJson(
        FIRST_SHA,
        SECOND_SHA,
      ),
    });

    const read = await readComparisonMarksSidecar(dir, SECOND_ID, log);
    if (!read.ok) {
      throw new Error("expected the legacy marks");
    }
    expect(JSON.parse(read.value)).toEqual({
      baselineSha: FIRST_SHA,
      headSha: SECOND_SHA,
      baselineLabel: "previous-brief",
      baselineIndex: 1,
      files: MARKS_FILES,
    });
  });

  it("refuses a legacy sidecar whose header is broken", async () => {
    await writeArtifacts(dir, {
      [`${SECOND_ID}.revchanges.json`]: JSON.stringify({ headSha: 1 }),
    });

    expect(await readComparisonMarksSidecar(dir, SECOND_ID, log)).toEqual(
      UNREADABLE,
    );
  });

  it("answers not-found with neither sidecar", async () => {
    expect(await readComparisonMarksSidecar(dir, SECOND_ID, log)).toEqual(
      NOT_FOUND,
    );
  });
});

describe("the verbatim sidecars", () => {
  it("serves the narrative as written", async () => {
    await writeArtifacts(dir, {
      [`${SECOND_ID}.revision-narrative.json`]: "narrative",
    });

    expect(await readRevisionNarrativeSidecar(dir, SECOND_ID, log)).toEqual({
      ok: true,
      value: "narrative",
    });
    expect(await readRevisionNarrativeSidecar(dir, FIRST_ID, log)).toEqual(
      NOT_FOUND,
    );
  });
});
