// Resolve durable wire anchors into brief-local ids against this view model.
// A draft with no rendered chunk is kept apart as unplaced: the submit route
// still posts it, so the submit guard measures it.
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { BriefChunk, Category } from "../../brief/types";
import { CommentAnchorKinds, type Result } from "types";
import type { BriefViewModel } from "@web/features/brief/utils";
import {
  createFileCommentAnchor,
  rowId,
  type CommentSide,
  type LineCommentAnchor,
  type ReviewComment,
} from "../utils/comments";
import { resolveChunkForLine } from "../utils/chunk-for-line";
import { getChunkRegion, isFlagUnderAnchor } from "../utils/state";
import type { ReviewOutcome, RiskEvidence } from "../utils/state";
import type { Disposition } from "./disposition";
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

function collectChunks(model: BriefViewModel): BriefChunk[] {
  return model.groups.flatMap((group) => group.chunks);
}

function lineOnSide(row: DiffLine, side: CommentSide): number | undefined {
  return side === "old" ? row.oldLine : row.newLine;
}

function chunkForDraft(
  chunks: BriefChunk[],
  draft: SessionLineDraftComment,
): BriefChunk | undefined {
  return resolveChunkForLine(
    chunks,
    draft.filePath,
    draft.startSide ?? draft.side,
    draft.startLine,
  );
}

interface CoveredRow {
  index: number;
  content: string;
}

/** Same-side: every row whose line on the draft's side is inside the range. */
function collectSameSideRows(
  rows: DiffLine[],
  draft: SessionLineDraftComment,
): CoveredRow[] {
  const covered: CoveredRow[] = [];

  for (const [index, row] of rows.entries()) {
    const line = lineOnSide(row, draft.side);
    if (line === undefined) continue;
    if (line < draft.startLine || line > draft.endLine) continue;
    covered.push({ index, content: row.content });
  }

  return covered;
}

/**
 * Cross-side: the contiguous render span from the start anchor to the end
 * anchor. Cross-side line numbers are not comparable, but the render order
 * is one sequence, so the span is positional.
 */
function collectCrossSideRows(
  rows: DiffLine[],
  draft: SessionLineDraftComment,
  startSide: CommentSide,
): CoveredRow[] {
  const startIndex = rows.findIndex(
    (row) => lineOnSide(row, startSide) === draft.startLine,
  );
  const endIndex = rows.findLastIndex(
    (row) => lineOnSide(row, draft.side) === draft.endLine,
  );
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return [];

  const covered: CoveredRow[] = [];

  for (let index = startIndex; index <= endIndex; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    // Hunk headers and notes carry no line on either side; a span crossing a
    // hunk boundary must not sweep them into the comment.
    if (row.oldLine === undefined && row.newLine === undefined) continue;
    covered.push({ index, content: row.content });
  }

  return covered;
}

/**
 * Rebuild row indexes from the diff; only GitHub coordinates are durable on the wire.
 * Empty rows are normal before the DB-path diff attaches; rendering uses coordinates.
 */
function rowsForDraft(
  chunk: BriefChunk,
  draft: SessionLineDraftComment,
): { rowIds: string[]; selectedText: string } {
  const rows = chunk.diff ?? [];
  const startSide = draft.startSide ?? draft.side;

  const covered =
    startSide === draft.side
      ? collectSameSideRows(rows, draft)
      : collectCrossSideRows(rows, draft, startSide);

  return {
    rowIds: covered.map((row) => rowId(chunk.id, row.index)),
    selectedText: covered.map((row) => row.content).join("\n"),
  };
}

interface ResolvedDrafts {
  reviewComments: ReviewComment[];
  unplacedDrafts: SessionDraftComment[];
}

function resolveDraftComments(
  payload: ReviewSessionPayload,
  chunks: BriefChunk[],
): ResolvedDrafts {
  const resolved: ResolvedDrafts = { reviewComments: [], unplacedDrafts: [] };
  for (const draft of payload.draftComments) {
    if (draft.kind === CommentAnchorKinds.FILE) {
      const inBrief = chunks.some((chunk) => chunk.file === draft.filePath);
      if (!inBrief) {
        resolved.unplacedDrafts.push(draft);
        continue;
      }
      resolved.reviewComments.push({
        id: draft.id,
        anchor: createFileCommentAnchor(draft.filePath),
        body: draft.body,
        status: draft.status,
        collapsed: false,
      });
      continue;
    }
    const chunk = chunkForDraft(chunks, draft);
    if (chunk === undefined) {
      resolved.unplacedDrafts.push(draft);
      continue;
    }

    const { rowIds, selectedText } = rowsForDraft(chunk, draft);
    const anchor: LineCommentAnchor = {
      kind: CommentAnchorKinds.LINE,
      chunkId: chunk.id,
      file: draft.filePath,
      side: draft.side,
      startLine: draft.startLine,
      endLine: draft.endLine,
      rowIds,
      selectedText,
    };
    if (draft.startSide !== undefined) {
      anchor.startSide = draft.startSide;
    }
    resolved.reviewComments.push({
      id: draft.id,
      anchor,
      body: draft.body,
      status: draft.status,
      collapsed: false,
    });
  }
  return resolved;
}

/** The store's evidence shape from the row's two columns. */
function toEvidence(
  evidence: SessionDisposition["evidence"],
): RiskEvidence | undefined {
  if (evidence === null) return undefined;
  const ref = evidence.ref ?? "";
  if (evidence.kind === "linked-comment") {
    return { kind: evidence.kind, commentId: ref };
  }
  if (evidence.kind === "chunk-reviewed") {
    return { kind: evidence.kind, chunkId: ref };
  }
  return { kind: evidence.kind, note: ref };
}

/**
 * A reopened carried decision reads as OPEN: the region it stood on was
 * touched, so the flag needs deciding again, and rendering it as still
 * decided would hide the one thing the attention list is asking for.
 */
function toDisposition(row: SessionDisposition): Disposition {
  if (row.carryStatus === "reopened") return { kind: "open" };
  if (row.decision === "dismissed") {
    return { kind: "dismissed", reason: row.reason ?? "" };
  }
  const evidence = toEvidence(row.evidence);
  const addressed: Disposition = { kind: "addressed" };

  if (evidence) addressed.evidence = evidence;

  return addressed;
}

/**
 * Dispositions land on every flag their anchor covers: the wire's region is
 * the chunk's, so one row addresses one flag unless a Brief carries the same
 * attribute twice over the same span.
 */
function toDispositions(
  payload: ReviewSessionPayload,
  model: BriefViewModel,
  base: Record<string, Disposition>,
): Record<string, Disposition> {
  const regions = new Map(
    collectChunks(model).map((chunk) => [chunk.id, getChunkRegion(chunk)]),
  );
  const resolved = { ...base };
  for (const row of payload.dispositions) {
    for (const flag of model.flags) {
      const anchor = {
        filePath: row.filePath,
        attribute: row.attribute,
        startLine: row.regionStart,
        endLine: row.regionEnd,
      };
      if (!isFlagUnderAnchor(flag, regions.get(flag.chunkId), anchor)) continue;
      resolved[flag.id] = toDisposition(row);
    }
  }
  return resolved;
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
  const chunks = collectChunks(model);
  const chunkIds = new Set(chunks.map((chunk) => chunk.id));
  const { reviewComments, unplacedDrafts } = resolveDraftComments(
    payload,
    chunks,
  );
  const dominants = { ...base.dominants };
  const reclassifiedGroups = new Set<string>();
  for (const entry of payload.reclassifications) {
    if (!(entry.changeGroupId in dominants)) continue;
    dominants[entry.changeGroupId] = entry.category;
    reclassifiedGroups.add(entry.changeGroupId);
  }
  return {
    dispositions: toDispositions(payload, model, base.dispositions),
    dominants,
    reclassifiedGroups,
    reviewedChunks: new Set(payload.readMarks.filter((id) => chunkIds.has(id))),
    reviewComments,
    unplacedDrafts,
    reviewOutcome: payload.reviewOutcome,
    submittedReviewIds: payload.submittedReviewIds
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id)),
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
