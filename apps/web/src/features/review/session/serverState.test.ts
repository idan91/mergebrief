// The wire→store resolution: the payload is keyed by content anchors, the
// store by brief-local ids, and everything that does not resolve is dropped
// rather than guessed at.
import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/utils/fixtures";
import { buildBriefViewModel } from "@web/features/brief/utils";
import {
  emptySessionPayload,
  parseReviewSessionPayload,
  sessionInitialState,
  type ReviewSessionPayload,
} from "./serverState";

const model = buildBriefViewModel(briefFixture);
const firstFlag = model.flags[0];
const firstChunk = model.groups[0]?.chunks[0];

function payload(overrides: Partial<ReviewSessionPayload>) {
  return { ...emptySessionPayload(), ...overrides };
}

describe("sessionInitialState", () => {
  it("takes the model's baseline when there is no session", () => {
    const state = sessionInitialState(model, undefined);
    expect(state.reviewedChunks.size).toBe(0);
    expect(Object.keys(state.dispositions)).toEqual(
      model.flags.map((flag) => flag.id),
    );
    expect(
      Object.values(state.dispositions).every((one) => one.kind === "open"),
    ).toBe(true);
  });

  it("resolves read marks, reclassifications and submitted review ids", () => {
    const state = sessionInitialState(
      model,
      payload({
        readMarks: [firstChunk?.id ?? "", "a-chunk-this-brief-lost"],
        reclassifications: [{ changeGroupId: "g1", category: "new-feature" }],
        submittedReviewIds: ["4647663464"],
        reviewOutcome: "approve",
      }),
    );
    expect([...state.reviewedChunks]).toEqual([firstChunk?.id]);
    expect(state.dominants["g1"]).toBe("new-feature");
    expect(state.reclassifiedGroups.has("g1")).toBe(true);
    expect(state.submittedReviewIds).toEqual([4_647_663_464]);
    expect(state.reviewOutcome).toBe("approve");
  });

  it("lands a draft on the chunk its coordinates fall in, rows rebuilt", () => {
    const chunk = firstChunk;
    if (chunk === undefined) throw new Error("fixture has no chunk");
    const line = chunk.addedRanges[0]?.start ?? 1;
    const state = sessionInitialState(
      model,
      payload({
        draftComments: [
          {
            id: "41",
            filePath: chunk.file,
            side: "new",
            startLine: line,
            endLine: line,
            body: "carried draft",
            status: "draft",
          },
          // No chunk in this Brief owns this file — dropped, not guessed.
          {
            id: "42",
            filePath: "src/deleted-since.ts",
            side: "new",
            startLine: 1,
            endLine: 1,
            body: "orphan",
            status: "draft",
          },
        ],
      }),
    );
    expect(state.reviewComments.map((comment) => comment.id)).toEqual(["41"]);
    const anchor = state.reviewComments[0]?.anchor;
    expect(anchor?.chunkId).toBe(chunk.id);
    expect(anchor?.rowIds.length).toBeGreaterThan(0);
    expect(anchor?.selectedText.length).toBeGreaterThan(0);
  });

  it("lands a disposition on the flag its anchor names, and only that one", () => {
    const flag = firstFlag;
    const chunk = model.groups
      .flatMap((group) => group.chunks)
      .find((one) => one.id === flag?.chunkId);
    if (flag === undefined || chunk === undefined) {
      throw new Error("fixture has no flagged chunk");
    }
    const bounds = [...chunk.addedRanges, ...chunk.removedRanges];
    const state = sessionInitialState(
      model,
      payload({
        dispositions: [
          {
            filePath: flag.file,
            attribute: flag.attr,
            regionStart: Math.min(...bounds.map((range) => range.start)),
            regionEnd: Math.max(...bounds.map((range) => range.end)),
            decision: "dismissed",
            reason: "not in this PR",
            evidence: null,
          },
          // Right file and attribute, a region no chunk carries: dropped.
          {
            filePath: flag.file,
            attribute: flag.attr,
            regionStart: 9000,
            regionEnd: 9001,
            decision: "addressed",
            reason: null,
            evidence: { kind: "manual-note", ref: "elsewhere" },
          },
        ],
      }),
    );
    expect(state.dispositions[flag.id]).toEqual({
      kind: "dismissed",
      reason: "not in this PR",
    });
    const others = model.flags.filter((one) => one.id !== flag.id);
    expect(
      others.every((one) => state.dispositions[one.id]?.kind === "open"),
    ).toBe(true);
  });

  it("fails whole rather than dropping a malformed draft", () => {
    // A silently dropped draft is a comment the reviewer writes twice.
    const parsed = parseReviewSessionPayload({
      ...emptySessionPayload(),
      draftComments: [{ id: "1", filePath: "a.ts", side: "sideways" }],
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects a body that is not an object", () => {
    expect(parseReviewSessionPayload(null).ok).toBe(false);
    expect(parseReviewSessionPayload("{}").ok).toBe(false);
  });
});
