// The wire→store resolution: the payload is keyed by content anchors, the
// store by brief-local ids, and everything that does not resolve is dropped
// rather than guessed at.
import { describe, expect, it } from "vitest";

import type { SessionPayload } from "contract";
import type { Equals } from "types";
import { briefFixture } from "@web/features/brief/fixtures";
import { buildBriefViewModel, GroupViewKinds } from "@web/features/brief/utils";
import {
  emptySessionPayload,
  parseReviewSessionPayload,
  sessionInitialState,
  type ReviewSessionPayload,
  type SessionDraftComment,
} from "./serverState";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** The contract's draft payload, minus `anchorStatus`, the one field this
 * store shape deliberately drops; the attention list renders it instead. */
type SourceDraftComment = Mutable<
  Omit<SessionPayload["draftComments"][number], "anchorStatus">
>;
/**
 * Lockstep pin: this store shape is hand-rolled, so a field added or retyped
 * on the wire would otherwise ship green while the bundle's guard rejects the
 * whole session read. `Equals` is exact and fails when the optional
 * `startSide` half drifts.
 */
const draftCommentPin: Equals<SessionDraftComment, SourceDraftComment> = true;
void draftCommentPin;

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
          // No chunk in this Brief owns this file, dropped, not guessed.
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

  it("lands a leftover-line draft on the remainder chunk", () => {
    const brief = structuredClone(briefFixture);
    const chunk = brief.chunks[0];
    if (chunk === undefined) throw new Error("fixture has no chunk");
    chunk.addedRanges = [
      { start: 1, end: 2 },
      { start: 100, end: 101 },
    ];
    brief.unattributed = [
      {
        file: chunk.file,
        addedRanges: [{ start: 50, end: 50 }],
        removedRanges: [],
      },
    ];
    const remainderModel = buildBriefViewModel(brief);
    const remainder = remainderModel.groups.find(
      (group) => group.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER,
    )?.chunks[0];
    if (remainder === undefined) throw new Error("expected a remainder chunk");

    const state = sessionInitialState(
      remainderModel,
      payload({
        draftComments: [
          {
            id: "61",
            filePath: chunk.file,
            side: "new",
            startLine: 50,
            endLine: 50,
            body: "leftover line",
            status: "draft",
          },
        ],
      }),
    );
    expect(state.reviewComments[0]?.anchor.chunkId).toBe(remainder.id);
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
            carryStatus: null,
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
            carryStatus: null,
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

  it("spans a two-side draft from its old start row to its new end row", () => {
    const cross = structuredClone(briefFixture);
    const chunk = cross.chunks[0];
    if (chunk === undefined) throw new Error("fixture has no chunk");
    chunk.addedRanges = [{ start: 10, end: 12 }];
    chunk.removedRanges = [{ start: 10, end: 11 }];
    chunk.diff = [
      { kind: "hunk", content: "@@ -9,3 +9,4 @@" },
      { kind: "ctx", content: "const a = 1;", oldLine: 9, newLine: 9 },
      { kind: "del", content: "old ten", oldLine: 10 },
      { kind: "del", content: "old eleven", oldLine: 11 },
      { kind: "add", content: "new ten", newLine: 10 },
      { kind: "add", content: "new eleven", newLine: 11 },
      { kind: "add", content: "new twelve", newLine: 12 },
    ];
    const crossModel = buildBriefViewModel(cross);
    const state = sessionInitialState(
      crossModel,
      payload({
        draftComments: [
          {
            id: "51",
            filePath: chunk.file,
            side: "new",
            startSide: "old",
            startLine: 10,
            endLine: 12,
            body: "spans both sides",
            status: "draft",
          },
        ],
      }),
    );
    const anchor = state.reviewComments[0]?.anchor;
    expect(anchor?.startSide).toBe("old");
    // Every row from the del at old 10 through the add at new 12.
    expect(anchor?.rowIds).toEqual(
      [2, 3, 4, 5, 6].map((i) => `${chunk.id}:${i}`),
    );
    expect(anchor?.selectedText).toBe(
      ["old ten", "old eleven", "new ten", "new eleven", "new twelve"].join(
        "\n",
      ),
    );
  });

  it("spans new\u2192old across hunks, skipping the header row", () => {
    const cross = structuredClone(briefFixture);
    const chunk = cross.chunks[0];
    if (chunk === undefined) throw new Error("fixture has no chunk");
    chunk.addedRanges = [{ start: 10, end: 10 }];
    chunk.removedRanges = [{ start: 20, end: 20 }];
    chunk.diff = [
      { kind: "hunk", content: "@@ -10,1 +10,1 @@" },
      { kind: "add", content: "new ten", newLine: 10 },
      { kind: "hunk", content: "@@ -19,2 +20,1 @@" },
      { kind: "ctx", content: "line nineteen", oldLine: 19, newLine: 20 },
      { kind: "del", content: "old twenty", oldLine: 20 },
    ];
    const crossModel = buildBriefViewModel(cross);
    const state = sessionInitialState(
      crossModel,
      payload({
        draftComments: [
          {
            id: "53",
            filePath: chunk.file,
            side: "old",
            startSide: "new",
            startLine: 10,
            endLine: 20,
            body: "backwards across blocks",
            status: "draft",
          },
        ],
      }),
    );
    const anchor = state.reviewComments[0]?.anchor;
    // The second hunk's header sits inside the span; it must not ride along.
    expect(anchor?.rowIds).toEqual([1, 3, 4].map((i) => `${chunk.id}:${i}`));
    expect(anchor?.selectedText).toBe(
      ["new ten", "line nineteen", "old twenty"].join("\n"),
    );
  });

  it("falls back to no rows when a two-side endpoint is not rendered", () => {
    const state = sessionInitialState(
      model,
      payload({
        draftComments: [
          {
            id: "52",
            filePath: firstChunk?.file ?? "",
            side: "new",
            startSide: "old",
            // No rendered row carries old line 5: the start anchor cannot
            // resolve, and a guessed span would attach to the wrong rows.
            startLine: 5,
            endLine: 10,
            body: "unresolvable start",
            status: "draft",
          },
        ],
      }),
    );
    const anchor = state.reviewComments[0]?.anchor;
    expect(anchor?.startSide).toBe("old");
    expect(anchor?.rowIds).toEqual([]);
    expect(anchor?.selectedText).toBe("");
  });

  it("accepts a payload draft carrying startSide", () => {
    const parsed = parseReviewSessionPayload({
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "1",
          filePath: "a.ts",
          side: "new",
          startSide: "old",
          startLine: 10,
          endLine: 12,
          body: "x",
          status: "draft",
        },
      ],
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects a draft whose startSide is outside the vocabulary", () => {
    const parsed = parseReviewSessionPayload({
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "1",
          filePath: "a.ts",
          side: "new",
          startSide: "sideways",
          startLine: 10,
          endLine: 12,
          body: "x",
          status: "draft",
        },
      ],
    });
    expect(parsed.ok).toBe(false);
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
