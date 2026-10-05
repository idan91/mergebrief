// The session read's wire shape before materialization: the side no row
// exists for, where the payload is an in-memory verdict. The integration
// suite covers a materialized session end to end; this pins what only the
// projection decides: the revision distance, the id a carried subject
// carries, and the default outcome a session with no row reports.
import {
  isReviewSessionId,
  type CarriedWork,
  type ReviewSessionId,
  type ReviewSessionView,
} from "persistence";
import { ChangeGroupCategories, ReviewOutcomes } from "types/reviews";
import {
  DispositionCarryStatuses,
  DispositionDecisions,
  DispositionEvidenceStatuses,
} from "types/dispositions";
import {
  AnchorStatuses,
  CommentAnchorKinds,
  DraftCommentSides,
  DraftCommentStatuses,
} from "types/comments";
import { describe, expect, it } from "vitest";
import { buildSessionPayload } from "../../src/routes/repos/pr/session/logic/payload";

function sessionId(value: bigint): ReviewSessionId {
  if (!isReviewSessionId(value)) {
    throw new Error("not a review session id");
  }
  return value;
}

const DECIDED_AT = new Date("2026-08-01T09:30:00.000Z");

const CARRIED: CarriedWork = {
  draftComments: [
    {
      id: 71n,
      anchor: {
        kind: CommentAnchorKinds.LINE,
        file: "src/app.ts",
        side: DraftCommentSides.NEW,
        startLine: 10,
        endLine: 12,
      },
      body: "this leaks",
      status: DraftCommentStatuses.DRAFT,
      anchorStatus: AnchorStatuses.ORPHANED,
      carriedFromCommentId: null,
    },
  ],
  readMarks: ["chunk-a", "chunk-b"],
  reclassifications: [
    { changeGroupId: "group-a", category: ChangeGroupCategories.BUGFIX },
  ],
  dispositions: [
    {
      filePath: "src/app.ts",
      attribute: "auth",
      regionStart: 4,
      regionEnd: 20,
      decision: DispositionDecisions.DISMISSED,
      reason: "covered by the gate",
      evidenceStatus: null,
      evidence: null,
      decidedAt: DECIDED_AT,
      carryStatus: DispositionCarryStatuses.REOPENED,
    },
  ],
};

const CARRIED_VIEW: ReviewSessionView = {
  session: undefined,
  carried: CARRIED,
  carriedFrom: {
    sessionId: sessionId(9n),
    headSha: "aaa111",
    headIndex: 3,
    items: 2,
  },
};

describe("buildSessionPayload", () => {
  it("reports an unmaterialized session and the default outcome", () => {
    const payload = buildSessionPayload(CARRIED_VIEW, 5);
    expect(payload.materialized).toBe(false);
    expect(payload.reviewOutcome).toBe(ReviewOutcomes.COMMENT);
    expect(payload.submittedReviewIds).toEqual([]);
  });

  it("states the revision distance to the Brief the work came from", () => {
    expect(buildSessionPayload(CARRIED_VIEW, 5).carriedFrom).toEqual({
      sessionId: "9",
      headSha: "aaa111",
      revisions: 2,
      items: 2,
    });
  });

  it("reports a first-ever session as carrying from nothing", () => {
    const payload = buildSessionPayload(
      { session: undefined, carried: CARRIED, carriedFrom: undefined },
      1,
    );
    expect(payload.carriedFrom).toBeNull();
  });

  it("keeps a carried draft addressable by the previous session's row", () => {
    const [draft] = buildSessionPayload(CARRIED_VIEW, 5).draftComments;
    expect(draft?.id).toBe("71");
  });

  it("gives a carried disposition no id because its anchor addresses it", () => {
    const [disposition] = buildSessionPayload(CARRIED_VIEW, 5).dispositions;
    expect(disposition?.id).toBeNull();
    expect(disposition?.decidedAt).toBe(DECIDED_AT.toISOString());
  });

  it("copies the read marks rather than aliasing the carried array", () => {
    const payload = buildSessionPayload(CARRIED_VIEW, 5);
    expect(payload.readMarks).toEqual(["chunk-a", "chunk-b"]);
    expect(payload.readMarks).not.toBe(CARRIED.readMarks);
  });

  it("projects the Attention List off the carried verdicts", () => {
    expect(buildSessionPayload(CARRIED_VIEW, 5).attention).toEqual([
      {
        kind: "orphaned-anchor",
        subject: { type: "draft-comment", id: "71", attribute: null },
        location: {
          kind: "line",
          filePath: "src/app.ts",
          startLine: 10,
          endLine: 12,
        },
        clearedBy: ["reanchor-draft-comment", "delete-draft-comment"],
      },
      {
        kind: "reopened-disposition",
        subject: { type: "disposition", id: null, attribute: "auth" },
        location: {
          kind: "line",
          filePath: "src/app.ts",
          startLine: 4,
          endLine: 20,
        },
        clearedBy: ["address-risk", "dismiss-risk"],
      },
    ]);
  });

  it("carries an evidence gap through to the payload", () => {
    const view: ReviewSessionView = {
      ...CARRIED_VIEW,
      carried: {
        ...CARRIED,
        dispositions: CARRIED.dispositions.map((row) => ({
          ...row,
          carryStatus: DispositionCarryStatuses.SETTLED,
          evidenceStatus: DispositionEvidenceStatuses.MISSING_EVIDENCE,
        })),
      },
    };
    const payload = buildSessionPayload(view, 5);
    expect(payload.dispositions[0]?.evidenceStatus).toBe(
      DispositionEvidenceStatuses.MISSING_EVIDENCE,
    );
    expect(payload.attention.map((entry) => entry.kind)).toEqual([
      "orphaned-anchor",
      "missing-evidence",
    ]);
  });
});
