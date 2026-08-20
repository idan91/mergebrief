// The Attention List's ladder: what earns an item and what carries silently.
// The integration suite covers the payload; this pins the three kinds.
import {
  AnchorStatus,
  DispositionCarryStatus,
  DispositionDecision,
  DispositionEvidenceStatus,
  DraftCommentStatus,
} from "persistence";
import { describe, expect, it } from "vitest";
import {
  deriveAttentionItems,
  type AttentionDisposition,
  type AttentionDraftComment,
} from "../src/routes/repos/pr/attention";

const COMMENT: AttentionDraftComment = {
  filePath: "src/app.ts",
  startLine: 10,
  endLine: 12,
  status: DraftCommentStatus.DRAFT,
  anchorStatus: AnchorStatus.ORPHANED,
};

const DISPOSITION: AttentionDisposition = {
  filePath: "src/app.ts",
  regionStart: 10,
  regionEnd: 12,
  decision: DispositionDecision.DISMISSED,
  carryStatus: DispositionCarryStatus.SETTLED,
  evidenceStatus: null,
};

function kinds(
  draftComments: readonly AttentionDraftComment[],
  dispositions: readonly AttentionDisposition[],
): string[] {
  return deriveAttentionItems({ draftComments, dispositions }).map(
    (item) => item.kind,
  );
}

describe("deriveAttentionItems", () => {
  it("lists an orphaned draft anchor, cleared by either repair", () => {
    const [item] = deriveAttentionItems({
      draftComments: [COMMENT],
      dispositions: [],
    });
    expect(item?.clearedBy).toEqual([
      "reanchor-draft-comment",
      "delete-draft-comment",
    ]);
    expect(item?.subject).toEqual({ type: "draft-comment", id: null });
  });

  it("stays silent on a moved anchor and on a published comment", () => {
    expect(
      kinds(
        [
          { ...COMMENT, anchorStatus: AnchorStatus.MOVED },
          { ...COMMENT, status: DraftCommentStatus.SUBMITTED },
        ],
        [],
      ),
    ).toEqual([]);
  });

  it("lists a reopened disposition and stays silent on settled and dropped", () => {
    expect(
      kinds(
        [],
        [
          { ...DISPOSITION, carryStatus: DispositionCarryStatus.REOPENED },
          DISPOSITION,
          { ...DISPOSITION, carryStatus: DispositionCarryStatus.DROPPED },
        ],
      ),
    ).toEqual(["reopened-disposition"]);
  });

  it("lists missing evidence only on a CARRIED disposition", () => {
    const missing = {
      evidenceStatus: DispositionEvidenceStatus.MISSING_EVIDENCE,
    };
    expect(
      kinds(
        [],
        [
          { ...DISPOSITION, ...missing },
          {
            ...DISPOSITION,
            ...missing,
            carryStatus: DispositionCarryStatus.NEW,
          },
          { ...DISPOSITION, ...missing, carryStatus: null },
          // Dropped: the flag stopped firing, so neither clearing operation
          // has anything to act on and the item could never be cleared.
          {
            ...DISPOSITION,
            ...missing,
            carryStatus: DispositionCarryStatus.DROPPED,
          },
        ],
      ),
    ).toEqual(["missing-evidence"]);
  });

  it("asks once when a row is both reopened and missing its evidence", () => {
    expect(
      kinds(
        [],
        [
          {
            ...DISPOSITION,
            carryStatus: DispositionCarryStatus.REOPENED,
            evidenceStatus: DispositionEvidenceStatus.MISSING_EVIDENCE,
          },
        ],
      ),
    ).toEqual(["reopened-disposition"]);
  });
});
