import { Roles } from "brief-core/types";
import type { AttentionItemKind } from "contract";
import { appI18n } from "../../../i18n/I18nProvider";
import { describe, expect, it } from "vitest";

import {
  type BriefChunk,
  GroupViewKinds,
  type RiskFlag,
} from "@web/features/brief/model";
import { type ReviewComment } from "./comments";
import type { SessionAttentionItem } from "../session/attention";
import type { Disposition } from "../session/disposition";
import {
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
} from "types/comments";
import {
  deriveCarriedItems,
  deriveUnresolvedItems,
  getChunkRegion,
  riskEvidenceLabel,
  summarySignatureLine,
  type CarriedInput,
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
    kind: CommentAnchorKinds.LINE,
    chunkId: "chunk-a",
    file: "src/a.ts",
    side: DiffSides.NEW,
    startLine: 12,
    endLine: 12,
    rowIds: ["chunk-a:2"],
    selectedText: "return next;",
  },
  body: "Could we cover this branch?",
  status: DraftCommentStatuses.DRAFT,
  collapsed: false,
} satisfies ReviewComment;

describe("riskEvidenceLabel", () => {
  it("describes linked comments, reviewed chunks, and manual notes", () => {
    expect(
      riskEvidenceLabel(
        appI18n.t,
        { kind: "linked-comment", commentId: "comment-1" },
        [reviewComment],
        [coreChunk],
      ),
    ).toBe("linked comment src/a.ts:+12");
    expect(
      riskEvidenceLabel(
        appI18n.t,
        { kind: "chunk-reviewed", chunkId: "chunk-a" },
        [reviewComment],
        [coreChunk],
      ),
    ).toBe("reviewed related chunk src/a.ts");
    expect(
      riskEvidenceLabel(
        appI18n.t,
        { kind: "manual-note", note: "Checked the fallback path." },
        [reviewComment],
        [coreChunk],
      ),
    ).toBe("manually verified: Checked the fallback path.");
  });
});

const remainderChunk = {
  id: "u-7e7f21ef",
  changeGroupId: GroupViewKinds.UNATTRIBUTED_REMAINDER,
  file: "src/orphan.ts",
  concern: "implementation",
  role: Roles.CORE,
  loc: { added: 3, deleted: 1 },
  addedRanges: [{ start: 1, end: 3 }],
  removedRanges: [{ start: 2, end: 2 }],
  riskSurface: [],
} satisfies BriefChunk;

describe("deriveUnresolvedItems", () => {
  it("finds open risks, evidence gaps, unread core, drafts and thin reasons", () => {
    expect(
      deriveUnresolvedItems({
        chunks: [coreChunk, supportingChunk],
        remainderChunks: [],
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
        remainderChunks: [],
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
        remainderChunks: [],
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

  it("emits unreviewed-remainder for unread view-model remainder chunks", () => {
    expect(
      deriveUnresolvedItems({
        chunks: [coreChunk],
        remainderChunks: [remainderChunk],
        flags: [],
        dispositions: {},
        reviewedChunkIds: new Set(),
        comments: [],
      }),
    ).toEqual([
      {
        id: "core:chunk-a",
        kind: "unreviewed-core",
        label: "src/a.ts",
        targetId: "chunk-a",
      },
      {
        id: "remainder:u-7e7f21ef",
        kind: "unreviewed-remainder",
        label: "src/orphan.ts",
        targetId: "u-7e7f21ef",
      },
    ]);
  });

  it("omits a reviewed remainder chunk", () => {
    expect(
      deriveUnresolvedItems({
        chunks: [coreChunk],
        remainderChunks: [remainderChunk],
        flags: [],
        dispositions: {},
        reviewedChunkIds: new Set(["chunk-a", "u-7e7f21ef"]),
        comments: [],
      }),
    ).toEqual([]);
  });

  it("never labels a remainder chunk as unreviewed-core", () => {
    const items = deriveUnresolvedItems({
      chunks: [coreChunk, remainderChunk],
      remainderChunks: [remainderChunk],
      flags: [],
      dispositions: {},
      reviewedChunkIds: new Set(),
      comments: [],
    });

    expect(items.filter((item) => item.kind === "unreviewed-core")).toEqual([
      {
        id: "core:chunk-a",
        kind: "unreviewed-core",
        label: "src/a.ts",
        targetId: "chunk-a",
      },
    ]);
    expect(
      items.filter((item) => item.kind === "unreviewed-remainder"),
    ).toEqual([
      {
        id: "remainder:u-7e7f21ef",
        kind: "unreviewed-remainder",
        label: "src/orphan.ts",
        targetId: "u-7e7f21ef",
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

const carriedChunk = {
  ...coreChunk,
  addedRanges: [{ start: 10, end: 13 }],
  riskSurface: ["no-tests"],
} satisfies BriefChunk;

function buildOrphanItem(): SessionAttentionItem {
  return {
    kind: "orphaned-anchor",
    subject: { type: "draft-comment", id: "comment-1" },
    location: {
      kind: CommentAnchorKinds.LINE,
      filePath: "src/a.ts",
      startLine: 12,
      endLine: 12,
    },
    clearedBy: ["reanchor-draft-comment", "delete-draft-comment"],
  };
}

function buildDispositionItem(kind: AttentionItemKind): SessionAttentionItem {
  return {
    kind,
    subject: { type: "disposition", attribute: "no-tests" },
    location: {
      kind: CommentAnchorKinds.LINE,
      filePath: "src/a.ts",
      startLine: 10,
      endLine: 13,
    },
    clearedBy: ["address-risk", "dismiss-risk"],
  };
}

function buildCarriedInput(
  attention: SessionAttentionItem[],
  overrides: Partial<CarriedInput> = {},
): CarriedInput {
  return {
    attention,
    chunks: [carriedChunk],
    regions: new Map([[carriedChunk.id, getChunkRegion(carriedChunk)]]),
    flags: [riskFlag],
    dispositions: {},
    comments: [reviewComment],
    deletedMissingDrafts: new Set<string>(),
    ...overrides,
  };
}

describe("deriveCarriedItems", () => {
  it("carries the server's clearing operations through untouched", () => {
    const [item] = deriveCarriedItems(buildCarriedInput([buildOrphanItem()]));
    expect(item?.clearedBy).toEqual([
      "reanchor-draft-comment",
      "delete-draft-comment",
    ]);
    expect(item?.targetId).toBe("chunk-a");
    expect(item?.actionTargetId).toBe("comment-1");
  });

  it("clears an orphaned anchor when the draft is deleted or re-placed", () => {
    expect(
      deriveCarriedItems(
        buildCarriedInput([buildOrphanItem()], { comments: [] }),
      ),
    ).toEqual([]);
    const moved = {
      ...reviewComment,
      anchor: { ...reviewComment.anchor, startLine: 40, endLine: 40 },
    };
    expect(
      deriveCarriedItems(
        buildCarriedInput([buildOrphanItem()], { comments: [moved] }),
      ),
    ).toEqual([]);
  });

  it("keeps an orphan with no rendered file and marks it unplaceable", () => {
    const items = deriveCarriedItems(
      buildCarriedInput([buildOrphanItem()], {
        comments: [],
        chunks: [supportingChunk],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.unplaceable).toBe(true);
    expect(items[0]?.targetId).toBe("");
  });

  it("clears an unplaceable orphan once the reviewer deletes it", () => {
    const gone = buildCarriedInput([buildOrphanItem()], {
      comments: [],
      chunks: [supportingChunk],
    });
    expect(deriveCarriedItems(gone)).toHaveLength(1);
    expect(
      deriveCarriedItems({
        ...gone,
        deletedMissingDrafts: new Set(["comment-1"]),
      }),
    ).toEqual([]);
  });

  it("matches a carried decision whose region no longer lines up exactly", () => {
    // Chunk boundaries are re-derived per Brief, so an exact-region match
    // would drop a decision the server still holds.
    const item = buildDispositionItem("reopened-disposition");
    const shifted: SessionAttentionItem = {
      ...item,
      location: {
        kind: CommentAnchorKinds.LINE,
        filePath: "src/a.ts",
        startLine: 12,
        endLine: 30,
      },
    };
    expect(deriveCarriedItems(buildCarriedInput([shifted]))).toHaveLength(1);
  });

  it("clears a reopened disposition once the flag is addressed or dismissed", () => {
    const item = buildDispositionItem("reopened-disposition");
    const open = deriveCarriedItems(buildCarriedInput([item]));
    expect(open).toHaveLength(1);
    expect(open[0]?.actionTargetId).toBe(riskFlag.id);
    for (const disposition of [
      { kind: "addressed", evidence: { kind: "manual-note", note: "n" } },
      { kind: "dismissed", reason: "not a risk here" },
    ] satisfies Disposition[]) {
      expect(
        deriveCarriedItems(
          buildCarriedInput([item], {
            dispositions: { [riskFlag.id]: disposition },
          }),
        ),
      ).toEqual([]);
    }
  });

  it("clears missing evidence once evidence lands or the flag is dismissed", () => {
    const item = buildDispositionItem("missing-evidence");
    const pending = deriveCarriedItems(
      buildCarriedInput([item], {
        dispositions: { [riskFlag.id]: { kind: "addressed" } },
      }),
    );
    expect(pending).toHaveLength(1);
    for (const disposition of [
      { kind: "addressed", evidence: { kind: "manual-note", note: "n" } },
      { kind: "dismissed", reason: "not a risk here" },
    ] satisfies Disposition[]) {
      expect(
        deriveCarriedItems(
          buildCarriedInput([item], {
            dispositions: { [riskFlag.id]: disposition },
          }),
        ),
      ).toEqual([]);
    }
  });

  it("drops a disposition item whose flag this Brief no longer raises", () => {
    expect(
      deriveCarriedItems(
        buildCarriedInput([buildDispositionItem("reopened-disposition")], {
          flags: [],
        }),
      ),
    ).toEqual([]);
  });
});
