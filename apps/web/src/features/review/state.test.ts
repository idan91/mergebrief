import { describe, expect, it } from "vitest";

import { Roles, type BriefChunk } from "../brief/types";
import type { RiskFlag } from "../brief/viewModel";
import type { ReviewComment } from "./comments";
import {
  deriveUnresolvedItems,
  riskEvidenceLabel,
  summarySignatureLine,
} from "./state";

const carrierChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: "implementation",
  role: Roles.Carrier,
  loc: { added: 1, deleted: 0 },
  addedRanges: [],
  removedRanges: [],
  riskSurface: [],
} satisfies BriefChunk;

const supportingChunk = {
  id: "chunk-b",
  changeGroupId: "g1",
  file: "src/a.test.ts",
  concern: "test",
  role: Roles.Supporting,
  loc: { added: 1, deleted: 0 },
  addedRanges: [],
  removedRanges: [],
  riskSurface: [],
} satisfies BriefChunk;

const riskFlag = {
  id: "chunk-a-no-tests-0",
  attr: "no-tests",
  chunkId: "chunk-a",
  file: "src/a.ts",
  groupId: "g1",
  description: "Changed code path has no direct test coverage.",
} satisfies RiskFlag;

const reviewComment = {
  id: "comment-1",
  anchor: {
    chunkId: "chunk-a",
    file: "src/a.ts",
    side: "new",
    startLine: 12,
    endLine: 12,
    rowIds: ["chunk-a:2"],
    selectedText: "return next;",
  },
  body: "Could we cover this branch?",
  status: "draft",
  collapsed: false,
} satisfies ReviewComment;

describe("riskEvidenceLabel", () => {
  it("describes linked comments, reviewed chunks, and manual notes", () => {
    expect(
      riskEvidenceLabel(
        { kind: "linked-comment", commentId: "comment-1" },
        [reviewComment],
        [carrierChunk],
      ),
    ).toBe("linked comment src/a.ts:+12");
    expect(
      riskEvidenceLabel(
        { kind: "chunk-reviewed", chunkId: "chunk-a" },
        [reviewComment],
        [carrierChunk],
      ),
    ).toBe("reviewed related chunk src/a.ts");
    expect(
      riskEvidenceLabel(
        { kind: "manual-note", note: "Checked the fallback path." },
        [reviewComment],
        [carrierChunk],
      ),
    ).toBe("manually verified: Checked the fallback path.");
  });
});

describe("deriveUnresolvedItems", () => {
  it("finds open risks, addressed risks without evidence, unreviewed carriers, draft comments, and thin dismissals", () => {
    expect(
      deriveUnresolvedItems({
        chunks: [carrierChunk, supportingChunk],
        flags: [riskFlag],
        dispositions: { "chunk-a-no-tests-0": { kind: "addressed" } },
        reviewedChunkIds: new Set(["chunk-b"]),
        comments: [reviewComment],
      }),
    ).toEqual([
      {
        id: "evidence:chunk-a-no-tests-0",
        kind: "missing-evidence",
        label: "no-tests @ src/a.ts",
        targetId: "chunk-a",
      },
      {
        id: "carrier:chunk-a",
        kind: "unreviewed-carrier",
        label: "src/a.ts",
        targetId: "chunk-a",
      },
      {
        id: "comment:comment-1",
        kind: "draft-comment",
        label: "src/a.ts:+12",
        targetId: "chunk-a",
      },
    ]);
  });

  it("finds open risks and thin dismissal reasons", () => {
    expect(
      deriveUnresolvedItems({
        chunks: [carrierChunk],
        flags: [riskFlag],
        dispositions: {
          "chunk-a-no-tests-0": { kind: "dismissed", reason: "ok" },
        },
        reviewedChunkIds: new Set(["chunk-a"]),
        comments: [],
      }),
    ).toEqual([
      {
        id: "dismissal:chunk-a-no-tests-0",
        kind: "thin-dismissal",
        label: "no-tests @ src/a.ts",
        targetId: "chunk-a",
      },
    ]);

    expect(
      deriveUnresolvedItems({
        chunks: [carrierChunk],
        flags: [riskFlag],
        dispositions: {},
        reviewedChunkIds: new Set(["chunk-a"]),
        comments: [],
      }),
    ).toEqual([
      {
        id: "risk:chunk-a-no-tests-0",
        kind: "open-risk",
        label: "no-tests @ src/a.ts",
        targetId: "chunk-a",
      },
    ]);
  });
});

describe("summarySignatureLine", () => {
  it("counts reviewed chunks and risk disposition", () => {
    expect(
      summarySignatureLine({
        reviewedChunks: 7,
        addressedRisks: 5,
        dismissedRisks: 1,
      }),
    ).toBe(
      "Reviewed with MergeBrief / review — summary: 7 chunks read, 5 risks addressed, 1 dismissed.",
    );
  });
});
