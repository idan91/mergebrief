import { appI18n } from "../../../i18n/I18nProvider";
import { describe, expect, it } from "vitest";

import { Roles, type BriefChunk } from "../../brief/types";
import type { RiskFlag } from "@web/features/brief/utils";
import type { ReviewComment } from "./comments";
import {
  deriveUnresolvedItems,
  riskEvidenceLabel,
  summarySignatureLine,
} from "./state";

const coreChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: "implementation",
  role: Roles.CORE,
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
  role: Roles.SUPPORTING,
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
  descriptionKey: "brief.risk.noTests",
  source: "built-in",
  deEmphasized: false,
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
        [coreChunk],
      ),
    ).toBe("linked comment src/a.ts:+12");
    expect(
      riskEvidenceLabel(
        { kind: "chunk-reviewed", chunkId: "chunk-a" },
        [reviewComment],
        [coreChunk],
      ),
    ).toBe("reviewed related chunk src/a.ts");
    expect(
      riskEvidenceLabel(
        { kind: "manual-note", note: "Checked the fallback path." },
        [reviewComment],
        [coreChunk],
      ),
    ).toBe("manually verified: Checked the fallback path.");
  });
});

describe("deriveUnresolvedItems", () => {
  it("finds open risks, addressed risks without evidence, unreviewed core chunks, draft comments, and thin dismissals", () => {
    expect(
      deriveUnresolvedItems({
        chunks: [coreChunk, supportingChunk],
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
        id: "core:chunk-a",
        kind: "unreviewed-core",
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
        chunks: [coreChunk],
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
        chunks: [coreChunk],
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

const t = appI18n.t;

describe("summarySignatureLine", () => {
  it("counts reviewed chunks and risk disposition", () => {
    expect(
      summarySignatureLine(t, {
        reviewedChunks: 7,
        addressedRisks: 5,
        dismissedRisks: 1,
      }),
    ).toBe(
      "Reviewed with MergeBrief / review — summary: 7 chunks read, 5 risks addressed, 1 dismissed.",
    );
  });
});
