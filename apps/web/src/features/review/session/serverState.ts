import type { Category } from "../../brief/types";
import type { CommentAnchorKinds, Result } from "types";
import type { BriefViewModel } from "@web/features/brief/utils";
import type { CommentSide, ReviewComment } from "../utils/comments";
import type { ReviewOutcome, RiskEvidence } from "../utils/state";
import {
  isAttentionItem,
  type DispositionCarryStatus,
  type SessionAttentionItem,
} from "./attention";
import { isRecord } from "@web/utils/typeGuards";
import {
  isArrayOf,
  isCarriedFrom,
  isDisposition,
  isDraftComment,
  isReclassification,
  isReviewOutcome,
  isStringArray,
} from "./payloadGuards";
import { deriveInitialState, type ReviewSessionState } from "./store";
import {
  getChunkRegions,
  resolveDispositions,
  resolveDraftComments,
} from "./anchors";

export interface SessionDraftCommentBase {
  id: string;
  filePath: string;
  body: string;
  status: ReviewComment["status"];
}

export interface SessionLineDraftComment extends SessionDraftCommentBase {
  kind: typeof CommentAnchorKinds.LINE;
  side: CommentSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: CommentSide;
  startLine: number;
  endLine: number;
}

export interface SessionFileDraftComment extends SessionDraftCommentBase {
  kind: typeof CommentAnchorKinds.FILE;
}

export type SessionDraftComment =
  | SessionLineDraftComment
  | SessionFileDraftComment;

/** Held drafts this Brief has no chunk for; the submit route posts them. */
export type UnplacedDrafts = SessionDraftComment[];

export interface SessionDisposition {
  filePath: string;
  attribute: string;
  regionStart: number;
  regionEnd: number;
  decision: "addressed" | "dismissed";
  reason: string | null;
  evidence: { kind: RiskEvidence["kind"]; ref: string | null } | null;
  /** The carry-over verdict on this row; null on a fresh decision. */
  carryStatus: DispositionCarryStatus | null;
}

export interface SessionReclassification {
  changeGroupId: string;
  category: Category;
}

/**
 * The span the carry-over row states. Null is a first-ever session and
 * nothing else, the row itself does not render.
 */
export interface SessionCarriedFrom {
  sessionId: string;
  headSha: string;
  /** Pushes between that Brief and this one; at least 1. */
  revisions: number;
  /** How much work carried, the receipt's count, never the session's total. */
  items: number;
}

/** The slice of the session read this bundle renders. */
export interface ReviewSessionPayload {
  /** False = no session row exists yet; every list is an in-memory verdict. */
  materialized: boolean;
  carriedFrom: SessionCarriedFrom | null;
  attention: SessionAttentionItem[];
  reviewOutcome: ReviewOutcome;
  draftComments: SessionDraftComment[];
  readMarks: string[];
  reclassifications: SessionReclassification[];
  dispositions: SessionDisposition[];
  submittedReviewIds: string[];
}

/** A session with no work in it, the shape a first-ever read returns. */
export function emptySessionPayload(): ReviewSessionPayload {
  return {
    materialized: false,
    carriedFrom: null,
    attention: [],
    reviewOutcome: "comment",
    draftComments: [],
    readMarks: [],
    reclassifications: [],
    dispositions: [],
    submittedReviewIds: [],
  };
}

/**
 * The store's initial state: the model's derived baseline with the server's
 * session laid over it. No payload (an unavailable session, or a Brief with
 * no session at all) is the baseline alone.
 */
export function sessionInitialState(
  model: BriefViewModel,
  payload: ReviewSessionPayload | undefined,
): ReviewSessionState {
  const base = deriveInitialState(model);
  if (payload === undefined) return base;
  const chunkRegions = getChunkRegions(model);
  const { reviewComments, unplacedDrafts } = resolveDraftComments(
    payload.draftComments,
    model,
  );
  const dominants = { ...base.dominants };
  const reclassifiedGroups = new Set<string>();
  for (const entry of payload.reclassifications) {
    if (!(entry.changeGroupId in dominants)) continue;
    dominants[entry.changeGroupId] = entry.category;
    reclassifiedGroups.add(entry.changeGroupId);
  }
  return {
    dispositions: resolveDispositions(
      payload.dispositions,
      model,
      base.dispositions,
    ),
    dominants,
    reclassifiedGroups,
    reviewedChunks: new Set(
      payload.readMarks.filter((id) => chunkRegions.has(id)),
    ),
    reviewComments,
    unplacedDrafts,
    reviewOutcome: payload.reviewOutcome,
    submittedReviewIds: payload.submittedReviewIds
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id)),
    carriedFrom: payload.carriedFrom,
    attention: payload.attention,
  };
}

/**
 * Boundary guard for the session read. A malformed payload FAILS rather than
 * degrading item-by-item: a silently dropped draft is a comment the reviewer
 * writes a second time.
 */
export function parseReviewSessionPayload(
  body: unknown,
): Result<ReviewSessionPayload, string> {
  if (!isRecord(body)) return { ok: false, error: "session: not an object" };
  const materialized = body["materialized"];
  const carriedFrom = body["carriedFrom"];
  const attention = body["attention"];
  const reviewOutcome = body["reviewOutcome"];
  const draftComments = body["draftComments"];
  const readMarks = body["readMarks"];
  const reclassifications = body["reclassifications"];
  const dispositions = body["dispositions"];
  const submittedReviewIds = body["submittedReviewIds"];
  if (typeof materialized !== "boolean") {
    return { ok: false, error: "session: materialized" };
  }
  if (carriedFrom !== null && !isCarriedFrom(carriedFrom)) {
    return { ok: false, error: "session: carriedFrom" };
  }
  if (!isArrayOf(attention, isAttentionItem)) {
    return { ok: false, error: "session: attention" };
  }
  if (!isReviewOutcome(reviewOutcome)) {
    return { ok: false, error: "session: reviewOutcome" };
  }
  if (!isArrayOf(draftComments, isDraftComment)) {
    return { ok: false, error: "session: draftComments" };
  }
  if (!isStringArray(readMarks)) {
    return { ok: false, error: "session: readMarks" };
  }
  if (!isArrayOf(reclassifications, isReclassification)) {
    return { ok: false, error: "session: reclassifications" };
  }
  if (!isArrayOf(dispositions, isDisposition)) {
    return { ok: false, error: "session: dispositions" };
  }
  if (!isStringArray(submittedReviewIds)) {
    return { ok: false, error: "session: submittedReviewIds" };
  }
  return {
    ok: true,
    value: {
      materialized,
      carriedFrom,
      attention,
      reviewOutcome,
      draftComments,
      readMarks,
      reclassifications,
      dispositions,
      submittedReviewIds,
    },
  };
}
