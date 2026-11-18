import {
  checkBriefForWrite,
  checkRevisionNarrativeForWrite,
  readStoredBrief,
} from "brief-core/artifact";
import { describe, expect, it } from "vitest";

import { parseFileDiffPatches } from "@web/features/brief/model";
import { DEMO_BASE_SHA, DEMO_REV1_HEAD, DEMO_REV2_HEAD } from "./consts";
import {
  briefRev1Text,
  briefRev2Text,
  diffsRev1Text,
  diffsRev2Text,
  revisionNarrativeText,
  revisionSpanDiffsText,
  revisionSpanMarksText,
} from "./index";

interface LineTotals {
  added: number;
  deleted: number;
}

interface DemoRevision {
  name: string;
  head: string;
  briefText: string;
  diffsText: string;
}

interface LineRange {
  start: number;
  end: number;
}

interface MarkedFile {
  file: string;
  addedRanges: LineRange[];
  removedRanges: LineRange[];
}

interface SpanMarks {
  baselineSha: string;
  headSha: string;
  files: MarkedFile[];
}

const REVISIONS: readonly DemoRevision[] = [
  {
    name: "revision 1",
    head: DEMO_REV1_HEAD,
    briefText: briefRev1Text,
    diffsText: diffsRev1Text,
  },
  {
    name: "revision 2",
    head: DEMO_REV2_HEAD,
    briefText: briefRev2Text,
    diffsText: diffsRev2Text,
  },
];

const HUNK_HEADER = "@@";
const ADDED_ROW = "+";
const REMOVED_ROW = "-";

/** The changed rows of one patch: those after its first hunk header. */
function countPatchLines(patch: string): LineTotals {
  const rows = patch.split("\n");
  const firstHunk = rows.findIndex((row) => row.startsWith(HUNK_HEADER));
  if (firstHunk === -1) {
    return { added: 0, deleted: 0 };
  }
  const body = rows.slice(firstHunk);

  return {
    added: body.filter((row) => row.startsWith(ADDED_ROW)).length,
    deleted: body.filter((row) => row.startsWith(REMOVED_ROW)).length,
  };
}

function sumLines(totals: readonly LineTotals[]): LineTotals {
  return {
    added: totals.reduce((sum, entry) => sum + entry.added, 0),
    deleted: totals.reduce((sum, entry) => sum + entry.deleted, 0),
  };
}

function countRangeLines(ranges: readonly LineRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
}

function readPatchTotals(diffsText: string): LineTotals {
  const patches = parseFileDiffPatches(JSON.parse(diffsText));
  if (!patches.ok) {
    throw new Error(patches.error);
  }
  return sumLines(patches.value.map((entry) => countPatchLines(entry.patch)));
}

describe.each(REVISIONS)("the demo brief of $name", (revision) => {
  it("passes the check the API runs before it stores a brief", () => {
    const check = checkBriefForWrite(JSON.parse(revision.briefText), []);

    expect(check.ok).toBe(true);
  });

  it("reads back whole, with nothing dropped", () => {
    const read = readStoredBrief(revision.briefText);
    if (!read.ok) {
      throw new Error(JSON.stringify(read.error));
    }

    expect(read.value.issues).toEqual([]);
    expect(read.value.brief.unattributed).toEqual([]);
  });

  it("names the span its patches were taken from", () => {
    const read = readStoredBrief(revision.briefText);
    if (!read.ok) {
      throw new Error(JSON.stringify(read.error));
    }
    const { brief } = read.value;

    expect(brief.pr.sha).toBe(revision.head);
    expect(brief.commitRange).toMatchObject({
      base: DEMO_BASE_SHA,
      head: revision.head,
    });
  });

  it("counts the lines its patches change", () => {
    const read = readStoredBrief(revision.briefText);
    if (!read.ok) {
      throw new Error(JSON.stringify(read.error));
    }
    const { brief } = read.value;
    const patchTotals = readPatchTotals(revision.diffsText);
    const chunkTotals = sumLines(brief.chunks.map((chunk) => chunk.loc));

    expect(brief.diffTotals).toEqual(patchTotals);
    expect(sumLines(brief.concernView)).toEqual(patchTotals);
    expect(chunkTotals).toEqual(patchTotals);
  });
});

describe("what the demo says changed between its revisions", () => {
  const marks = JSON.parse(revisionSpanMarksText) as SpanMarks;

  it("marks the lines the span's patches change, between the two heads", () => {
    const markedTotals: LineTotals = {
      added: countRangeLines(marks.files.flatMap((file) => file.addedRanges)),
      deleted: countRangeLines(
        marks.files.flatMap((file) => file.removedRanges),
      ),
    };

    expect(marks.baselineSha).toBe(DEMO_REV1_HEAD);
    expect(marks.headSha).toBe(DEMO_REV2_HEAD);
    expect(markedTotals).toEqual(readPatchTotals(revisionSpanDiffsText));
  });

  it("holds a narrative the API would store", () => {
    const check = checkRevisionNarrativeForWrite(
      JSON.parse(revisionNarrativeText),
    );

    expect(check.ok).toBe(true);
  });

  it("tells every marked file's story under a group of the brief", () => {
    const check = checkRevisionNarrativeForWrite(
      JSON.parse(revisionNarrativeText),
    );
    const read = readStoredBrief(briefRev2Text);
    if (!check.ok || !read.ok || !("chunks" in check.value)) {
      throw new Error("the narrative or the brief does not read");
    }
    const groupIds = read.value.brief.changeGroups.map((group) => group.id);
    const toldFiles = new Set(check.value.chunks.map((chunk) => chunk.file));
    const toldGroups = check.value.chunks.map(
      (chunk) => chunk.briefChangeGroupId,
    );

    expect(marks.files.map((file) => file.file)).toEqual(
      expect.arrayContaining([...toldFiles]),
    );
    expect(toldFiles.size).toBe(marks.files.length);
    expect(groupIds).toEqual(expect.arrayContaining(toldGroups));
  });
});
