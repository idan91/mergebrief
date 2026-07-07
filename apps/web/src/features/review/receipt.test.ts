import { describe, expect, it } from "vitest";

import { briefFixture } from "../brief/fixtures";
import { buildBriefViewModel } from "../brief/viewModel";
import { buildReceipt } from "./receipt";
import type { SessionSnapshot } from "./session";

const model = buildBriefViewModel(briefFixture);
const flagId = model.flags[0]!.id;
const secondFlag = model.flags[1]!;

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    briefId: "fixture-brief-1",
    dispositions: { [flagId]: { kind: "open" } },
    dominants: { g1: "bugfix" },
    reclassifiedGroupIds: [],
    reviewedChunkIds: [],
    checkedItems: {},
    reviewComments: [],
    reviewOutcome: "comment",
    ...overrides,
  };
}

describe("buildReceipt", () => {
  it("reports progress and subject from the brief and snapshot", () => {
    const receipt = buildReceipt(
      snapshot({ reviewedChunkIds: ["chunk-a"] }),
      briefFixture,
      model,
    );
    expect(receipt.subject).toEqual({
      repo: "acme/widgets",
      number: 42,
      sha: "abcdef1234567890",
    });
    expect(receipt.progress).toEqual({
      reviewedChunks: 1,
      chunkTotal: 2,
      flagTotal: 2,
    });
  });

  it("counts dispositions and lists an open flag by default", () => {
    const receipt = buildReceipt(snapshot(), briefFixture, model);
    expect(receipt.counts).toEqual({ addressed: 0, dismissed: 0, open: 2 });
    expect(receipt.open).toEqual([
      { id: flagId, attr: "no-tests", file: "src/leak.ts" },
      {
        id: secondFlag.id,
        attr: "comment-contradicts-code",
        file: "src/leak.ts",
      },
    ]);
  });

  it("carries a dismissal reason verbatim", () => {
    const receipt = buildReceipt(
      snapshot({
        dispositions: {
          [flagId]: {
            kind: "dismissed",
            reason: "Covered by integration suite.",
          },
        },
      }),
      briefFixture,
      model,
    );
    expect(receipt.counts.dismissed).toBe(1);
    expect(receipt.dismissed).toEqual([
      {
        id: flagId,
        attr: "no-tests",
        file: "src/leak.ts",
        reason: "Covered by integration suite.",
      },
    ]);
  });

  it("resolves addressed evidence per flag", () => {
    const receipt = buildReceipt(
      snapshot({
        dispositions: {
          [flagId]: {
            kind: "addressed",
            evidence: { kind: "chunk-reviewed", chunkId: "chunk-a" },
          },
        },
      }),
      briefFixture,
      model,
    );
    expect(receipt.addressed).toEqual([
      {
        id: flagId,
        attr: "no-tests",
        file: "src/leak.ts",
        evidence: { kind: "chunk-reviewed", chunkId: "chunk-a" },
        evidenceLabel: "reviewed related chunk src/leak.ts",
      },
    ]);
  });

  it("keeps addressed-pending-evidence (no evidence key)", () => {
    const receipt = buildReceipt(
      snapshot({ dispositions: { [flagId]: { kind: "addressed" } } }),
      briefFixture,
      model,
    );
    expect(receipt.addressed).toEqual([
      { id: flagId, attr: "no-tests", file: "src/leak.ts" },
    ]);
  });

  it("counts reclassified groups and maps comments to first lines with status", () => {
    const anchor = {
      chunkId: "chunk-a",
      file: "src/leak.ts",
      side: "new" as const,
      startLine: 10,
      endLine: 12,
      rowIds: ["chunk-a:1"],
      selectedText: "validate(a);",
    };
    const receipt = buildReceipt(
      snapshot({
        reclassifiedGroupIds: ["g1"],
        reviewComments: [
          {
            id: "c1",
            anchor,
            body: "Please add a test.\nSecond line.",
            status: "draft",
            collapsed: false,
          },
          {
            // Posted by an earlier submit — the receipt must distinguish it
            // from the drafts the NEXT submit will ship (BRIEF-23).
            id: "c0",
            anchor,
            body: "Already posted.",
            status: "submitted",
            collapsed: false,
          },
        ],
      }),
      briefFixture,
      model,
    );
    expect(receipt.reclassifiedCount).toBe(1);
    expect(receipt.comments).toEqual([
      {
        id: "c1",
        file: "src/leak.ts",
        side: "new",
        startLine: 10,
        endLine: 12,
        firstLine: "Please add a test.",
        status: "draft",
      },
      {
        id: "c0",
        file: "src/leak.ts",
        side: "new",
        startLine: 10,
        endLine: 12,
        firstLine: "Already posted.",
        status: "submitted",
      },
    ]);
  });
});
