import type { Logger } from "logging";
import type {
  AppDatabase,
  ChunkReadInput,
  DispositionAnchor,
  DraftAnchor,
  GroupReclassificationInput,
  NewDraft,
  ReviewDraftCommentRow,
  ReviewSessionError,
} from "persistence";
import type { DispositionEvidence } from "types/dispositions";
import type { ReviewOutcome } from "types/reviews";
import type { Result } from "types/utils";
import type { SessionRejectedFailure } from "../../../../shared-errors/failures";
import type { BriefSpan } from "./schemas";

/** What a bound session write, or the session read, can refuse with. */
export type SessionWriteFailure = SessionRejectedFailure<ReviewSessionError>;

/** The span names no Brief stored on the access step's row. */
export interface SessionTargetNotFoundFailure {
  readonly kind: "target-not-found";
}

export type SessionOperationFailure =
  | SessionTargetNotFoundFailure
  | SessionWriteFailure;

export type SessionRequestResult<Value> = Result<
  Value,
  SessionOperationFailure
>;

/** Why a write meant only for a session that already exists wrote nothing. */
export type ExistingSessionWriteFailure =
  | SessionTargetNotFoundFailure
  | { readonly kind: "no-session" }
  | SessionWriteFailure;

/** The store, and the request's log an unreadable Brief is reported on. */
export interface SessionStoreDeps {
  readonly handle: AppDatabase;
  readonly log: Logger;
}

/** Every operation names its Brief, never "the newest Brief". */
export interface SessionRequest {
  readonly span: BriefSpan;
}

export interface CreateDraftRequest extends SessionRequest {
  readonly draft: NewDraft;
}

export interface DraftRequest extends SessionRequest {
  readonly draftId: bigint;
}

export interface UpdateDraftRequest extends DraftRequest {
  readonly body: string;
}

export interface ReanchorDraftRequest extends DraftRequest {
  readonly anchor: DraftAnchor;
}

export interface SetChunkReadRequest extends SessionRequest {
  readonly chunkRead: ChunkReadInput;
}

export interface ReclassifyGroupRequest extends SessionRequest {
  readonly reclassification: GroupReclassificationInput;
}

export interface DismissRiskRequest extends SessionRequest {
  readonly flags: readonly DispositionAnchor[];
  readonly reason: string;
}

/** A flag and what the reviewer says addressed it. */
export interface EvidencedFlag extends DispositionAnchor {
  readonly evidence: DispositionEvidence;
}

export interface AddressRiskRequest extends SessionRequest {
  readonly flags: readonly EvidencedFlag[];
}

export interface ReopenRiskRequest extends SessionRequest {
  readonly flags: readonly DispositionAnchor[];
}

export interface SetReviewOutcomeRequest extends SessionRequest {
  readonly outcome: ReviewOutcome;
}

/**
 * A draft as a publish reads it before claiming: a session row, or before
 * the session exists, a carried draft named by its source row's id.
 */
export type HeldDraft = Pick<
  ReviewDraftCommentRow,
  | "id"
  | "carriedFromCommentId"
  | "anchor"
  | "body"
  | "status"
  | "anchorStatus"
  | "publishClaim"
  | "publishClaimedAt"
>;
