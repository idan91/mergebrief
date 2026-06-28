import { describe, expect, it } from "vitest";

import { briefFixture } from "../brief/fixtures";
import { buildBriefViewModel } from "../brief/viewModel";
import { buildReceipt } from "./receipt";
import type { SessionSnapshot } from "./session";

const model = buildBriefViewModel(briefFixture);
const flagId = model.flags[0]!.id;

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
      flagTotal: 1,
    });
  });

  it("counts dispositions and lists an open flag by default", () => {
    const receipt = buildReceipt(snapshot(), briefFixture, model);
    expect(receipt.counts).toEqual({ addressed: 0, dismissed: 0, open: 1 });
    expect(receipt.open).toEqual([{ attr: "no-tests", file: "src/leak.ts" }]);
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
      { attr: "no-tests", file: "src/leak.ts" },
    ]);
  });

  it("counts reclassified groups and maps comments to first lines", () => {
    const receipt = buildReceipt(
      snapshot({
        reclassifiedGroupIds: ["g1"],
        reviewComments: [
          {
            id: "c1",
            anchor: {
              chunkId: "chunk-a",
              file: "src/leak.ts",
              side: "new",
              startLine: 10,
              endLine: 12,
              rowIds: ["chunk-a:1"],
              selectedText: "validate(a);",
            },
            body: "Please add a test.\nSecond line.",
            status: "draft",
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
      },
    ]);
  });
});
