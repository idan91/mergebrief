import { checkBriefForWrite, readStoredBrief } from "brief-core/artifact";
import { describe, expect, it } from "vitest";

import { parseFileDiffPatches } from "@web/features/brief/model";
import { DEMO_BASE_SHA, DEMO_REV2_HEAD } from "./consts";
import { briefRev2Text, diffsRev2Text } from "./index";

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

const REVISIONS: readonly DemoRevision[] = [
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
