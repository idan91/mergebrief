// The Review Session's wire shapes: the session read's payload, and what each
// session write sends and answers. One payload type covers both sides of
// materialization, a session's own rows and the carry-over verdicts held in
// memory, because they differ only in whether a subject has a row id yet;
// `materialized` is what tells them apart.
import type {
  AnchorStatus,
  ChangeGroupCategory,
  CommentAnchorKind,
  DispositionCarryStatus,
  DispositionDecision,
  DispositionEvidence,
  DispositionEvidenceKind,
  DispositionEvidenceStatus,
  DiffSide,
  DraftCommentStatus,
  ReviewOutcome,
} from "types";
import type { AttentionItem } from "./attention";

/**
 * The span the carry-over row states: the Brief the work came from, and how
 * many pushes since. Null is a first-ever session and nothing else.
 */
export interface CarriedFromPayload {
  readonly sessionId: string;
  readonly headSha: string;
  /** Pushes between that Brief and this one; at least 1. */
  readonly revisions: number;
  /**
   * How much work carried, counted by the store off the carry markers and the
   * previous session's own rows, never off this session's row totals, which
   * the reviewer's later work would inflate. Zero is a previous session that
   * carried nothing, and the one case with no row to render.
   */
  readonly items: number;
}

export interface SessionPayload {
  /** False = no row exists; every list below is an in-memory verdict. */
  readonly materialized: boolean;
  readonly carriedFrom: CarriedFromPayload | null;
  readonly reviewOutcome: ReviewOutcome;
  readonly draftComments: readonly DraftCommentPayload[];
  readonly readMarks: readonly string[];
  readonly reclassifications: readonly ReclassificationPayload[];
  readonly dispositions: readonly DispositionPayload[];
  readonly submittedReviewIds: readonly string[];
  readonly attention: readonly AttentionItem[];
}

export interface DraftCommentPayloadBase {
  /** The row holding this draft, the previous session's before materializing. */
  readonly id: string;
  readonly filePath: string;
  readonly body: string;
  readonly status: DraftCommentStatus;
  readonly anchorStatus: AnchorStatus | null;
}

export interface LineDraftCommentPayload extends DraftCommentPayloadBase {
  readonly kind: Extract<CommentAnchorKind, "line">;
  readonly side: DiffSide;
  /** Present only when the range genuinely crosses sides. */
  readonly startSide?: DiffSide;
  readonly startLine: number;
  readonly endLine: number;
}

export interface FileDraftCommentPayload extends DraftCommentPayloadBase {
  readonly kind: Extract<CommentAnchorKind, "file">;
}

export type DraftCommentPayload =
  | LineDraftCommentPayload
  | FileDraftCommentPayload;

export interface ReclassificationPayload {
  readonly changeGroupId: string;
  readonly category: ChangeGroupCategory;
}

export interface DispositionPayload {
  readonly id: string | null;
  readonly filePath: string;
  readonly attribute: string;
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly decision: DispositionDecision;
  readonly reason: string | null;
  readonly carryStatus: DispositionCarryStatus | null;
  readonly evidenceStatus: DispositionEvidenceStatus | null;
  /** What the decision stands on; null on a dismissal or once it was lost. */
  readonly evidence: DispositionEvidence | null;
  readonly decidedAt: string;
}

/** A line draft's coordinates; a line anchor may leave `kind` off. */
export interface LineDraftAnchorWire {
  readonly kind?: Extract<CommentAnchorKind, "line">;
  readonly filePath: string;
  readonly side: DiffSide;
  /** Present only when the range genuinely crosses sides. */
  readonly startSide?: DiffSide;
  readonly startLine: number;
  readonly endLine: number;
}

export interface FileDraftAnchorWire {
  readonly kind: Extract<CommentAnchorKind, "file">;
  readonly filePath: string;
}

export type DraftAnchorWire = LineDraftAnchorWire | FileDraftAnchorWire;

/** `create-draft-comment`: the anchor and the body in one object. */
export type CreateDraftCommentBody = DraftAnchorWire & {
  readonly body: string;
};

export interface CreateDraftCommentResponse {
  readonly draftId: string;
}

export interface UpdateDraftCommentBody {
  readonly body: string;
}

export type ReanchorDraftCommentBody = DraftAnchorWire;

export interface ReclassifyGroupBody {
  readonly category: ChangeGroupCategory;
}

/** A flag named by the anchor its disposition row keys on, never a Brief-local id. */
export interface FlagAnchorWire {
  readonly filePath: string;
  readonly attribute: string;
  readonly regionStart: number;
  readonly regionEnd: number;
}

/** What an addressing claim points at; `ref` reads per `kind` and is never empty. */
export interface EvidenceWire {
  readonly kind: DispositionEvidenceKind;
  readonly ref: string;
}

export interface EvidencedFlagAnchorWire extends FlagAnchorWire {
  readonly evidence: EvidenceWire;
}

export interface DismissRiskBody {
  readonly flags: readonly FlagAnchorWire[];
  readonly reason: string;
}

export interface AddressRiskBody {
  readonly flags: readonly EvidencedFlagAnchorWire[];
}

export interface ReopenRiskBody {
  readonly flags: readonly FlagAnchorWire[];
}

/** The three risk writes' answer: how many dispositions the write changed. */
export interface RiskWriteResponse {
  readonly count: number;
}

export interface SetReviewOutcomeBody {
  readonly outcome: ReviewOutcome;
}

/** The outcome as stored, which the server decides, not an echo of the request. */
export interface SetReviewOutcomeResponse {
  readonly outcome: ReviewOutcome;
}
