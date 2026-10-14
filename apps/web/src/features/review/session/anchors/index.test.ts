import { CommentAnchorKinds, DiffSides, DraftCommentStatuses } from "types";
import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { buildBriefViewModel } from "@web/features/brief/model";
import {
  type CommentAnchor,
  type FileCommentAnchor,
  type LineCommentAnchor,
} from "../../utils/comments";
import type { RiskEvidence } from "../../utils/state";
import type { SessionDisposition, SessionDraftComment } from "../serverState";
import type { DraftAnchorWire, FlagAnchorWire } from "contract";
import {
  buildDraftAnchorWire,
  buildEvidenceWire,
  buildFlagAnchorWires,
  getChunkRegions,
  resolveDispositions,
  resolveDraftComments,
  resolveEvidence,
} from "./index";

const crossBrief = structuredClone(briefFixture);
const crossChunk = crossBrief.chunks[0];
if (crossChunk === undefined) {
  throw new Error("fixture has no chunk");
}
crossChunk.addedRanges = [{ start: 10, end: 12 }];
crossChunk.removedRanges = [{ start: 10, end: 11 }];
crossChunk.diff = [
  { kind: "hunk", content: "@@ -9,3 +9,4 @@" },
  { kind: "ctx", content: "const a = 1;", oldLine: 9, newLine: 9 },
  { kind: "del", content: "old ten", oldLine: 10 },
  { kind: "del", content: "old eleven", oldLine: 11 },
  { kind: "add", content: "new ten", newLine: 10 },
  { kind: "add", content: "new eleven", newLine: 11 },
  { kind: "add", content: "new twelve", newLine: 12 },
];
const model = buildBriefViewModel(crossBrief);

function makeDraftFromWire(wire: DraftAnchorWire): SessionDraftComment {
  const base = { id: "7", body: "draft", status: DraftCommentStatuses.DRAFT };
  if (wire.kind === CommentAnchorKinds.FILE) {
    return { ...base, ...wire };
  }
  return { ...base, ...wire, kind: CommentAnchorKinds.LINE };
}

function roundTripAnchor(anchor: CommentAnchor): CommentAnchor | undefined {
  const draft = makeDraftFromWire(buildDraftAnchorWire(anchor));
  const resolved = resolveDraftComments([draft], model);
  return resolved.reviewComments[0]?.anchor;
}

function makeDismissalFromWire(wire: FlagAnchorWire): SessionDisposition {
  return {
    ...wire,
    decision: "dismissed",
    reason: "not here",
  };
}

describe("draft anchors", () => {
  it("round-trips a same-side multi-line anchor", () => {
    const anchor: LineCommentAnchor = {
      kind: CommentAnchorKinds.LINE,
      chunkId: crossChunk.id,
      file: crossChunk.file,
      side: DiffSides.NEW,
      startLine: 10,
      endLine: 11,
      rowIds: [`${crossChunk.id}:4`, `${crossChunk.id}:5`],
      selectedText: "new ten\nnew eleven",
    };
    expect(roundTripAnchor(anchor)).toEqual(anchor);
  });

  it("round-trips a cross-side multi-line anchor", () => {
    const anchor: LineCommentAnchor = {
      kind: CommentAnchorKinds.LINE,
      chunkId: crossChunk.id,
      file: crossChunk.file,
      side: DiffSides.NEW,
      startSide: DiffSides.OLD,
      startLine: 10,
      endLine: 12,
      rowIds: [2, 3, 4, 5, 6].map((index) => `${crossChunk.id}:${index}`),
      selectedText: [
        "old ten",
        "old eleven",
        "new ten",
        "new eleven",
        "new twelve",
      ].join("\n"),
    };
    expect(roundTripAnchor(anchor)).toEqual(anchor);
  });

  it("round-trips a file anchor with no line fields on the wire", () => {
    const anchor: FileCommentAnchor = {
      kind: CommentAnchorKinds.FILE,
      file: crossChunk.file,
    };
    expect(buildDraftAnchorWire(anchor)).toEqual({
      kind: CommentAnchorKinds.FILE,
      filePath: crossChunk.file,
    });
    expect(roundTripAnchor(anchor)).toEqual(anchor);
  });

  it("keeps a draft no chunk holds apart as unplaced", () => {
    const gone: SessionDraftComment = {
      id: "9",
      filePath: "src/deleted-since.ts",
      kind: CommentAnchorKinds.FILE,
      body: "gone",
      status: DraftCommentStatuses.DRAFT,
    };
    expect(resolveDraftComments([gone], model)).toEqual({
      reviewComments: [],
      unplacedDrafts: [gone],
    });
  });
});

describe("flag anchors", () => {
  it("round-trips every flag back onto itself and no other", () => {
    const wires = buildFlagAnchorWires(model);
    expect(wires.size).toBe(model.flags.length);

    for (const flag of model.flags) {
      const wire = wires.get(flag.id);
      if (wire === undefined) {
        throw new Error(`no wire anchor for ${flag.id}`);
      }
      const resolved = resolveDispositions(
        [makeDismissalFromWire(wire)],
        model,
        {},
      );
      expect(Object.keys(resolved)).toEqual([flag.id]);
    }
  });

  it("round-trips each evidence kind through its one ref", () => {
    const evidence: RiskEvidence[] = [
      { kind: "linked-comment", commentId: "12" },
      { kind: "chunk-reviewed", chunkId: crossChunk.id },
      { kind: "manual-note", note: "covered upstream" },
    ];
    for (const one of evidence) {
      expect(resolveEvidence(buildEvidenceWire(one))).toEqual(one);
    }
  });
});

describe("getChunkRegions", () => {
  it("builds one region map per model and hands back the same one", () => {
    const regions = getChunkRegions(model);
    expect(getChunkRegions(model)).toBe(regions);
    expect(regions.get(crossChunk.id)).toEqual({ start: 10, end: 12 });
    expect(getChunkRegions(buildBriefViewModel(crossBrief))).not.toBe(regions);
  });
});
