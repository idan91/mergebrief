import {
  AttentionItemKinds,
  AttentionSubjectTypes,
  type AttentionItem,
  type AttentionSubject,
  type CarriedFromPayload,
  type DispositionPayload,
  type FileAttentionLocation,
  type FileDraftCommentPayload,
  type LineAttentionLocation,
  type LineDraftCommentPayload,
  type ReclassificationPayload,
  type SessionPayload,
} from "contract";
import {
  ChangeGroupCategories,
  CommentAnchorKinds,
  DiffSides,
  DispositionDecisions,
  type DispositionEvidence,
  DispositionEvidenceKinds,
  DraftCommentStatuses,
  type Equals,
  ReviewOutcomes,
} from "types";
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";

import type { ReadsWireFields } from "@web/test/wire-fields";
import type { SessionAttentionItem } from "./attention";
import {
  parseReviewSessionPayload,
  type reviewSessionPayloadSchema,
  type sessionAttentionItemSchema,
  type sessionAttentionSubjectSchema,
  type sessionCarriedFromSchema,
  type sessionDispositionSchema,
  type sessionDraftCommentSchema,
  type sessionEvidenceSchema,
  type sessionFileAttentionLocationSchema,
  type sessionFileDraftCommentSchema,
  type sessionHeldAttentionLocationSchema,
  type sessionHeldDraftCommentSchema,
  type sessionLineAttentionLocationSchema,
  type sessionLineDraftCommentSchema,
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

const LINE_DRAFT = {
  id: "1",
  filePath: "a.ts",
  kind: CommentAnchorKinds.LINE,
  side: DiffSides.NEW,
  startLine: 10,
  endLine: 12,
  body: "x",
  status: DraftCommentStatuses.DRAFT,
};

const FILE_DRAFT = {
  id: "2",
  filePath: "b.ts",
  kind: CommentAnchorKinds.FILE,
  body: "y",
  status: DraftCommentStatuses.DRAFT,
};

/** What a draft whose anchor this bundle cannot read is held as. */
const HELD_LINE_DRAFT = {
  id: "1",
  filePath: "a.ts",
  kind: "unknown",
  body: "x",
  status: DraftCommentStatuses.DRAFT,
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

  it("fails a line draft whose line is malformed", () => {
    const parsed = parseReviewSessionPayload({
      ...emptySessionPayload(),
      draftComments: [{ ...LINE_DRAFT, side: "future-side", startLine: 0 }],
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

    const {
      reason: _reason,
      carryStatus: _carry,
      ...disposition
    } = DISPOSITION;
    const { evidence: _evidence, ...unevidenced } = disposition;
    const { attribute: _attribute, ...subject } = ATTENTION_ITEM.subject;

    expect(parseReviewSessionPayload(body)).toStrictEqual({
      ok: true,
      value: {
        ...body,
        attention: [{ ...ATTENTION_ITEM, subject }],
        dispositions: [disposition, unevidenced],
      },
    });
  });

  it("reads a first-ever session's null carriedFrom as absent", () => {
    const parsed = parseReviewSessionPayload({
      ...emptySessionPayload(),
      carriedFrom: null,
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value).not.toHaveProperty("carriedFrom");
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
    ["a missing review outcome", { reviewOutcome: undefined }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      parseReviewSessionPayload({ ...emptySessionPayload(), ...overrides }).ok,
    ).toBe(false);
  });
});

describe("parseReviewSessionPayload with a newer vocabulary", () => {
  function parseValue(overrides: object): ReviewSessionPayload {
    const parsed = parseReviewSessionPayload({
      ...emptySessionPayload(),
      ...overrides,
    });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    return parsed.value;
  }

  it("reads an unknown review outcome as unknown", () => {
    expect(parseValue({ reviewOutcome: "merge" }).reviewOutcome).toBe(
      "unknown",
    );
  });

  it("reads an unknown category as unknown", () => {
    const value = parseValue({
      reclassifications: [{ changeGroupId: "g1", category: "x" }],
    });
    expect(value.reclassifications).toEqual([
      { changeGroupId: "g1", category: "unknown" },
    ]);
  });

  it("reads an unknown decision and evidence kind as unknown", () => {
    const value = parseValue({
      dispositions: [
        { ...DISPOSITION, decision: "x", evidence: { kind: "x", ref: "1" } },
      ],
    });
    expect(value.dispositions[0]).toMatchObject({
      decision: "unknown",
      evidence: { kind: "unknown", ref: "1" },
    });
  });

  it("drops an unknown carry status and keeps the disposition", () => {
    const value = parseValue({
      dispositions: [{ ...DISPOSITION, carryStatus: "x" }],
    });
    expect(value.dispositions).toHaveLength(1);
    expect(value.dispositions[0]).not.toHaveProperty("carryStatus");
  });

  it("reads an unknown draft status as unknown and keeps the draft", () => {
    const value = parseValue({
      draftComments: [
        {
          id: "1",
          filePath: "a.ts",
          kind: CommentAnchorKinds.FILE,
          body: "x",
          status: "queued",
        },
      ],
    });
    expect(value.draftComments).toEqual([
      expect.objectContaining({ id: "1", status: "unknown" }),
    ]);
  });

  it("reads an unknown attention kind and subject type as unknown", () => {
    const value = parseValue({
      attention: [
        {
          ...ATTENTION_ITEM,
          kind: "stale-thing",
          subject: { type: "thread", id: "1", attribute: null },
        },
      ],
    });
    expect(value.attention[0]).toMatchObject({
      kind: "unknown",
      subject: { type: "unknown", id: "1" },
    });
  });

  it("holds a draft whose side it predates and keeps the others", () => {
    const value = parseValue({
      draftComments: [{ ...LINE_DRAFT, side: "future-side" }, FILE_DRAFT],
    });
    expect(value.draftComments).toStrictEqual([HELD_LINE_DRAFT, FILE_DRAFT]);
  });

  it("holds a draft whose startSide it predates", () => {
    const value = parseValue({
      draftComments: [{ ...LINE_DRAFT, startSide: "future-side" }],
    });
    expect(value.draftComments).toStrictEqual([HELD_LINE_DRAFT]);
  });

  it("holds a draft whose anchor kind it predates", () => {
    const value = parseValue({
      draftComments: [
        { ...FILE_DRAFT, kind: "symbol", symbol: "run" },
        LINE_DRAFT,
      ],
    });
    expect(value.draftComments).toStrictEqual([
      { ...FILE_DRAFT, kind: "unknown" },
      LINE_DRAFT,
    ]);
  });

  it("keeps an attention item whose location kind it predates", () => {
    const value = parseValue({
      attention: [
        {
          ...ATTENTION_ITEM,
          location: { kind: "symbol", filePath: "a.ts", symbol: "run" },
        },
      ],
    });
    expect(value.attention[0]?.location).toStrictEqual({
      kind: "unknown",
      filePath: "a.ts",
    });
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

const CONTRACT_PINS = {
  SessionPayload: true satisfies ReadsWireFields<
    z.output<typeof reviewSessionPayloadSchema>,
    SessionPayload
  >,
  LineDraftComment: true satisfies ReadsWireFields<
    z.output<typeof sessionLineDraftCommentSchema>,
    LineDraftCommentPayload
  >,
  FileDraftComment: true satisfies ReadsWireFields<
    z.output<typeof sessionFileDraftCommentSchema>,
    FileDraftCommentPayload
  >,
  HeldDraftComment: true satisfies ReadsWireFields<
    z.output<typeof sessionHeldDraftCommentSchema>,
    LineDraftCommentPayload | FileDraftCommentPayload
  >,
  Disposition: true satisfies ReadsWireFields<
    z.output<typeof sessionDispositionSchema>,
    DispositionPayload
  >,
  Evidence: true satisfies ReadsWireFields<
    z.output<typeof sessionEvidenceSchema>,
    DispositionEvidence
  >,
  Reclassification: true satisfies ReadsWireFields<
    z.output<typeof sessionReclassificationSchema>,
    ReclassificationPayload
  >,
  CarriedFrom: true satisfies ReadsWireFields<
    z.output<typeof sessionCarriedFromSchema>,
    CarriedFromPayload
  >,
  AttentionItem: true satisfies ReadsWireFields<
    z.output<typeof sessionAttentionItemSchema>,
    AttentionItem
  >,
  AttentionSubject: true satisfies ReadsWireFields<
    z.output<typeof sessionAttentionSubjectSchema>,
    AttentionSubject
  >,
  LineAttentionLocation: true satisfies ReadsWireFields<
    z.output<typeof sessionLineAttentionLocationSchema>,
    LineAttentionLocation
  >,
  FileAttentionLocation: true satisfies ReadsWireFields<
    z.output<typeof sessionFileAttentionLocationSchema>,
    FileAttentionLocation
  >,
  HeldAttentionLocation: true satisfies ReadsWireFields<
    z.output<typeof sessionHeldAttentionLocationSchema>,
    LineAttentionLocation | FileAttentionLocation
  >,
} as const;

describe("session schemas read only what the contract sends", () => {
  it.each(Object.entries(CONTRACT_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});
