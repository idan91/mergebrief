// The server-held session, resolved into the store's initial state.
//
// The wire keys everything by content anchor — file, attribute, line region —
// while the store keys by brief-local ids, so every list is resolved against
// the view model here. An anchor that resolves to nothing is DROPPED: it
// belongs to a chunk this Brief no longer renders, and the attention list is
// what tells the reviewer about it.
import { Categories } from "../../brief/types";
import type { BriefChunk, Category, DiffLine } from "../../brief/types";
import type { Result } from "types";
import type { BriefViewModel } from "@web/features/brief/utils";
import type { CommentSide, ReviewComment } from "../utils/comments";
import { rowId } from "../utils/comments";
import { getChunkRegion, isFlagUnderAnchor } from "../utils/state";
import type { ReviewOutcome, RiskEvidence } from "../utils/state";
import type { Disposition } from "./disposition";
import {
  isAttentionItem,
  isCarryStatus,
  type DispositionCarryStatus,
  type SessionAttentionItem,
} from "./attention";
import { deriveInitialState, type ReviewSessionState } from "./store";

export interface SessionDraftComment {
  id: string;
  filePath: string;
  side: CommentSide;
  startLine: number;
  endLine: number;
  body: string;
  status: ReviewComment["status"];
}

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
 * nothing else — the row itself does not render.
 */
export interface SessionCarriedFrom {
  sessionId: string;
  headSha: string;
  /** Pushes between that Brief and this one; at least 1. */
  revisions: number;
  /** How much work carried — the receipt's count, never the session's total. */
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

/** A session with no work in it — the shape a first-ever read returns. */
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

/**
 * The chunk a draft's coordinates land in: same file, region covering the
 * start line. An uncovered line takes the nearest chunk in the file rather
 * than nothing — the ranges name changed lines, a comment may sit on context,
 * and a draft that resolves to no chunk renders nowhere at all. A file this
 * Brief does not show has no home, and the attention list says so.
 */
function chunkForDraft(
  chunks: BriefChunk[],
  draft: SessionDraftComment,
): BriefChunk | undefined {
  const inFile = chunks.filter((chunk) => chunk.file === draft.filePath);
  const covering = inFile.find((chunk) => {
    const region = getChunkRegion(chunk);
    return draft.startLine >= region.start && draft.startLine <= region.end;
  });
  if (covering !== undefined) return covering;
  const preceding = inFile.filter(
    (chunk) => getChunkRegion(chunk).start <= draft.startLine,
  );
  return preceding.at(-1) ?? inFile[0];
}

/**
 * The rendered rows the draft covers. Rebuilt from the diff rather than
 * stored: the wire carries GitHub's coordinates, which are the durable
 * anchor, and row indexes are a property of this render. Empty is the normal
 * case on the DB path, where the diff attaches after this runs — the renderer
 * falls back to the coordinates.
 */
function rowsForDraft(
  chunk: BriefChunk,
  draft: SessionDraftComment,
): { rowIds: string[]; selectedText: string } {
  const rows = chunk.diff ?? [];
  const covered = rows.flatMap((row, index) => {
    const line = lineOnSide(row, draft.side);
    if (line === undefined) return [];
    if (line < draft.startLine || line > draft.endLine) return [];
    return [{ index, content: row.content }];
  });
  return {
    rowIds: covered.map((row) => rowId(chunk.id, row.index)),
    selectedText: covered.map((row) => row.content).join("\n"),
  };
}

function toReviewComments(
  payload: ReviewSessionPayload,
  chunks: BriefChunk[],
): ReviewComment[] {
  return payload.draftComments.flatMap((draft) => {
    const chunk = chunkForDraft(chunks, draft);
    if (chunk === undefined) return [];
    return [
      {
        id: draft.id,
        anchor: {
          chunkId: chunk.id,
          file: draft.filePath,
          side: draft.side,
          startLine: draft.startLine,
          endLine: draft.endLine,
          ...rowsForDraft(chunk, draft),
        },
        body: draft.body,
        status: draft.status,
        collapsed: false,
      },
    ];
  });
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
  return { kind: "addressed", ...(evidence ? { evidence } : {}) };
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
    reviewComments: toReviewComments(payload, chunks),
    reviewOutcome: payload.reviewOutcome,
    submittedReviewIds: payload.submittedReviewIds
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id)),
  };
}

const DRAFT_STATUSES = new Set<string>(["draft", "submitted"]);
const SIDES = new Set<string>(["old", "new"] satisfies CommentSide[]);
const DECISIONS = new Set<string>(["addressed", "dismissed"]);
const EVIDENCE_KINDS = new Set<string>([
  "linked-comment",
  "chunk-reviewed",
  "manual-note",
]);
const CATEGORIES = new Set<string>(Object.values(Categories));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isReviewOutcome(value: unknown): value is ReviewOutcome {
  return (
    value === "comment" || value === "approve" || value === "request-changes"
  );
}

function isDraftComment(value: unknown): value is SessionDraftComment {
  return (
    isObject(value) &&
    typeof value["id"] === "string" &&
    typeof value["filePath"] === "string" &&
    typeof value["body"] === "string" &&
    typeof value["side"] === "string" &&
    SIDES.has(value["side"]) &&
    typeof value["status"] === "string" &&
    DRAFT_STATUSES.has(value["status"]) &&
    isLine(value["startLine"]) &&
    isLine(value["endLine"])
  );
}

function isEvidence(value: unknown): boolean {
  return (
    value === null ||
    (isObject(value) &&
      typeof value["kind"] === "string" &&
      EVIDENCE_KINDS.has(value["kind"]) &&
      (value["ref"] === null || typeof value["ref"] === "string"))
  );
}

function isDisposition(value: unknown): value is SessionDisposition {
  return (
    isObject(value) &&
    typeof value["filePath"] === "string" &&
    typeof value["attribute"] === "string" &&
    isLine(value["regionStart"]) &&
    isLine(value["regionEnd"]) &&
    typeof value["decision"] === "string" &&
    DECISIONS.has(value["decision"]) &&
    (value["reason"] === null || typeof value["reason"] === "string") &&
    (value["carryStatus"] === null || isCarryStatus(value["carryStatus"])) &&
    isEvidence(value["evidence"])
  );
}

function isCarriedFrom(value: unknown): value is SessionCarriedFrom {
  return (
    isObject(value) &&
    typeof value["sessionId"] === "string" &&
    typeof value["headSha"] === "string" &&
    typeof value["revisions"] === "number" &&
    Number.isInteger(value["revisions"]) &&
    value["revisions"] >= 1 &&
    typeof value["items"] === "number" &&
    Number.isInteger(value["items"]) &&
    value["items"] >= 0
  );
}

function isReclassification(value: unknown): value is SessionReclassification {
  return (
    isObject(value) &&
    typeof value["changeGroupId"] === "string" &&
    typeof value["category"] === "string" &&
    CATEGORIES.has(value["category"])
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((it) => typeof it === "string");
}

function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every((item) => guard(item));
}

/**
 * Boundary guard for the session read. A malformed payload FAILS rather than
 * degrading item-by-item: a silently dropped draft is a comment the reviewer
 * writes a second time.
 */
export function parseReviewSessionPayload(
  body: unknown,
): Result<ReviewSessionPayload, string> {
  if (!isObject(body)) return { ok: false, error: "session: not an object" };
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
