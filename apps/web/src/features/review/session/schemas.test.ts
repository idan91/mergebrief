import { AttentionItemKinds, AttentionSubjectTypes } from "contract";
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import {
  ChangeGroupCategories,
  CommentAnchorKinds,
  DiffSides,
  DispositionDecisions,
  DispositionEvidenceKinds,
  DraftCommentStatuses,
  type Equals,
  ReviewOutcomes,
} from "types";

import type { SessionAttentionItem } from "./attention";
import {
  parseReviewSessionPayload,
  type reviewSessionPayloadSchema,
  type sessionAttentionItemSchema,
  type sessionCarriedFromSchema,
  type sessionDispositionSchema,
  type sessionDraftCommentSchema,
  type sessionReclassificationSchema,
} from "./schemas";
import {
  emptySessionPayload,
  type ReviewSessionPayload,
  type SessionCarriedFrom,
  type SessionDisposition,
  type SessionDraftComment,
  type SessionReclassification,
} from "./serverState";

const ATTENTION_ITEM = {
  kind: AttentionItemKinds.ORPHANED_ANCHOR,
  subject: {
    type: AttentionSubjectTypes.DRAFT_COMMENT,
    id: "1",
    attribute: null,
  },
  location: { kind: CommentAnchorKinds.FILE, filePath: "a.ts" },
  clearedBy: ["delete-draft-comment"],
};

const DISPOSITION = {
  filePath: "a.ts",
  attribute: "touches-auth",
  regionStart: 3,
  regionEnd: 9,
  decision: DispositionDecisions.ADDRESSED,
  reason: null,
  evidence: { kind: DispositionEvidenceKinds.MANUAL_NOTE, ref: "checked" },
  carryStatus: null,
};

const CARRIED_FROM = { sessionId: "s1", headSha: "h1", revisions: 1, items: 0 };

describe("parseReviewSessionPayload", () => {
  it("accepts a payload draft carrying startSide", () => {
    const parsed = parseReviewSessionPayload({
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "1",
          filePath: "a.ts",
          kind: CommentAnchorKinds.LINE,
          side: DiffSides.NEW,
          startSide: DiffSides.OLD,
          startLine: 10,
          endLine: 12,
          body: "x",
          status: DraftCommentStatuses.DRAFT,
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
          kind: CommentAnchorKinds.LINE,
          side: DiffSides.NEW,
          startSide: "sideways",
          startLine: 10,
          endLine: 12,
          body: "x",
          status: DraftCommentStatuses.DRAFT,
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

  it("reads a full payload with carried work, attention and dispositions", () => {
    const body = {
      ...emptySessionPayload(),
      materialized: true,
      carriedFrom: CARRIED_FROM,
      attention: [ATTENTION_ITEM],
      reviewOutcome: ReviewOutcomes.APPROVE,
      readMarks: ["chunk-1"],
      reclassifications: [
        { changeGroupId: "g1", category: ChangeGroupCategories.LOGIC_REFACTOR },
      ],
      dispositions: [DISPOSITION, { ...DISPOSITION, evidence: null }],
      submittedReviewIds: ["42"],
    };

    expect(parseReviewSessionPayload(body)).toEqual({ ok: true, value: body });
  });

  it("accepts a file draft whatever line fields it carries", () => {
    const parsed = parseReviewSessionPayload({
      ...emptySessionPayload(),
      draftComments: [
        {
          id: "1",
          filePath: "a.ts",
          kind: CommentAnchorKinds.FILE,
          side: "sideways",
          body: "x",
          status: DraftCommentStatuses.DRAFT,
        },
      ],
    });

    expect(parsed.ok).toBe(true);
  });

  it.each([
    [
      "an attention item nothing clears",
      { attention: [{ ...ATTENTION_ITEM, clearedBy: [] }] },
    ],
    [
      "a carry over spanning no revisions",
      { carriedFrom: { ...CARRIED_FROM, revisions: 0 } },
    ],
    [
      "an unknown evidence kind",
      {
        dispositions: [{ ...DISPOSITION, evidence: { kind: "x", ref: null } }],
      },
    ],
    [
      "an unknown carry status",
      { dispositions: [{ ...DISPOSITION, carryStatus: "x" }] },
    ],
    [
      "an unknown category",
      { reclassifications: [{ changeGroupId: "g1", category: "x" }] },
    ],
    ["an unknown review outcome", { reviewOutcome: "merge" }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      parseReviewSessionPayload({ ...emptySessionPayload(), ...overrides }).ok,
    ).toBe(false);
  });
});

const SCHEMA_PINS = {
  SessionDraftComment: true satisfies Equals<
    z.output<typeof sessionDraftCommentSchema>,
    SessionDraftComment
  >,
  SessionDisposition: true satisfies Equals<
    z.output<typeof sessionDispositionSchema>,
    SessionDisposition
  >,
  SessionReclassification: true satisfies Equals<
    z.output<typeof sessionReclassificationSchema>,
    SessionReclassification
  >,
  SessionCarriedFrom: true satisfies Equals<
    z.output<typeof sessionCarriedFromSchema>,
    SessionCarriedFrom
  >,
  SessionAttentionItem: true satisfies Equals<
    z.output<typeof sessionAttentionItemSchema>,
    SessionAttentionItem
  >,
  ReviewSessionPayload: true satisfies Equals<
    z.output<typeof reviewSessionPayloadSchema>,
    ReviewSessionPayload
  >,
} as const;

describe("session schemas match their interfaces", () => {
  it.each(Object.entries(SCHEMA_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});
