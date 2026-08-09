import type { Category } from "../../brief/types";
import type { ReviewComment } from "../utils/comments";
import type { ReviewOutcome } from "../utils/state";
import type { Disposition } from "./disposition";
import type { MindMapState } from "./store";

/**
 * The frozen, serializable session snapshot persisted per brief to
 * sessionStorage — Sets flattened to arrays. Also the Receipt builder's input.
 * The `v2` storage key avoids colliding with old `v1` data.
 */
export interface SessionSnapshot {
  briefId: string;
  dispositions: Record<string, Disposition>;
  dominants: Record<string, Category>;
  reclassifiedGroupIds: string[];
  reviewedChunkIds: string[];
  reviewComments: ReviewComment[];
  reviewOutcome: ReviewOutcome;
  /** Absent in older stored snapshots; hydrates to []. */
  submittedReviewIds?: number[];
  /** Reply drafts per thread root id; absent in older snapshots. */
  replyDrafts?: Record<string, string>;
}

const STORAGE_KEY = "code-review:session:v2";
const MAX_SNAPSHOTS = 12;

export function serializeSnapshot(
  briefId: string,
  state: MindMapState,
): SessionSnapshot {
  return {
    briefId,
    dispositions: state.dispositions,
    dominants: state.dominants,
    reclassifiedGroupIds: [...state.reclassifiedGroups],
    reviewedChunkIds: [...state.reviewedChunks],
    reviewComments: state.reviewComments,
    reviewOutcome: state.reviewOutcome,
    submittedReviewIds: [...state.submittedReviewIds],
    replyDrafts: { ...state.replyDrafts },
  };
}

export function snapshotToState(snapshot: SessionSnapshot): MindMapState {
  return {
    dispositions: snapshot.dispositions,
    dominants: snapshot.dominants,
    reclassifiedGroups: new Set(snapshot.reclassifiedGroupIds),
    reviewedChunks: new Set(snapshot.reviewedChunkIds),
    reviewComments: snapshot.reviewComments,
    reviewOutcome: snapshot.reviewOutcome,
    submittedReviewIds: snapshot.submittedReviewIds ?? [],
    replyDrafts: snapshot.replyDrafts ?? {},
  };
}

const REVIEW_OUTCOMES: readonly string[] = [
  "comment",
  "approve",
  "request-changes",
] satisfies readonly ReviewOutcome[];
// 3 elements; `includes` keeps the readonly-array type-guard idiom.
// eslint-disable-next-line unicorn/prefer-set-has
const RISK_EVIDENCE_KINDS: readonly string[] = [
  "linked-comment",
  "chunk-reviewed",
  "manual-note",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isDisposition(value: unknown): value is Disposition {
  if (!isObject(value)) return false;
  const kind = value["kind"];
  if (kind === "open") return true;
  if (kind === "dismissed") return typeof value["reason"] === "string";
  if (kind === "addressed") {
    const evidence = value["evidence"];
    return (
      evidence === undefined ||
      (isObject(evidence) &&
        typeof evidence["kind"] === "string" &&
        RISK_EVIDENCE_KINDS.includes(evidence["kind"]))
    );
  }
  return false;
}

function isReviewComment(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value["id"] === "string" &&
    typeof value["body"] === "string" &&
    typeof value["status"] === "string" &&
    isObject(value["anchor"])
  );
}

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!isObject(value)) return false;
  const dispositions = value["dispositions"];
  const dominants = value["dominants"];
  return (
    typeof value["briefId"] === "string" &&
    isObject(dispositions) &&
    Object.values(dispositions).every(isDisposition) &&
    isObject(dominants) &&
    Object.values(dominants).every((entry) => typeof entry === "string") &&
    isStringArray(value["reclassifiedGroupIds"]) &&
    isStringArray(value["reviewedChunkIds"]) &&
    Array.isArray(value["reviewComments"]) &&
    value["reviewComments"].every(isReviewComment) &&
    typeof value["reviewOutcome"] === "string" &&
    REVIEW_OUTCOMES.includes(value["reviewOutcome"]) &&
    isOptionalNumberArray(value["submittedReviewIds"]) &&
    isOptionalStringRecord(value["replyDrafts"])
  );
}

function isOptionalStringRecord(value: unknown): boolean {
  return (
    value === undefined ||
    (isObject(value) &&
      Object.values(value).every((entry) => typeof entry === "string"))
  );
}

function isOptionalNumberArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "number"))
  );
}

function isSnapshotMap(
  value: unknown,
): value is Record<string, SessionSnapshot> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(isSessionSnapshot);
}

function readSnapshotMap(): Record<string, SessionSnapshot> {
  if (typeof window === "undefined") return {};
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSnapshotMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Read one brief's persisted snapshot (client-only; SSR has no storage). */
export function readSnapshot(briefId: string): SessionSnapshot | undefined {
  return readSnapshotMap()[briefId];
}

/** Write one brief's snapshot, capping the stored map at MAX_SNAPSHOTS. */
export function writeSnapshot(snapshot: SessionSnapshot): void {
  if (typeof window === "undefined") return;
  const map = readSnapshotMap();
  // Re-insert as the newest key (delete-then-set) so eviction is true LRU:
  // re-writing a brief refreshes its recency instead of leaving it stale.
  delete map[snapshot.briefId];
  map[snapshot.briefId] = snapshot;
  // Evict oldest-first until back under the cap (handles >1 over in one pass).
  let ids = Object.keys(map);
  while (ids.length > MAX_SNAPSHOTS && ids[0]) {
    delete map[ids[0]];
    ids = Object.keys(map);
  }
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Record a successful submit directly in the PERSISTED snapshot: flip the
 * given comment ids to `submitted`, and — when the submit carried a verdict —
 * reset the outcome to `comment`. A submit can resolve after the provider (and
 * its persistence subscriber) unmounted, so mutating the orphaned store alone
 * would let a reload re-ship posted comments and re-arm the verdict. No-op
 * when nothing is persisted.
 */
export function markSnapshotCommentsSubmitted(
  briefId: string,
  ids: readonly string[],
  resetOutcomeToComment = false,
  reviewId?: number,
): void {
  if (ids.length === 0 && !resetOutcomeToComment && reviewId === undefined)
    return;
  const snapshot = readSnapshot(briefId);
  if (snapshot === undefined) return;
  const flipped = new Set(ids);
  const recorded = snapshot.submittedReviewIds ?? [];
  writeSnapshot({
    ...snapshot,
    reviewComments: snapshot.reviewComments.map((comment) =>
      flipped.has(comment.id) ? { ...comment, status: "submitted" } : comment,
    ),
    ...(resetOutcomeToComment ? { reviewOutcome: "comment" } : {}),
    // The created review id is the own-comment join key — written durably in
    // the SAME snapshot write as the flips.
    submittedReviewIds:
      reviewId === undefined || recorded.includes(reviewId)
        ? recorded
        : [...recorded, reviewId],
  });
}

/**
 * Persist one reply draft DIRECTLY: the composer's unmount can race the
 * provider's debounced sessionStorage flush, so the last local edit writes
 * durably itself. An empty body clears the entry. No-op when nothing is
 * persisted for the brief.
 */
export function persistReplyDraft(
  briefId: string,
  threadId: number,
  body: string,
): void {
  const snapshot = readSnapshot(briefId);
  if (snapshot === undefined) return;
  const drafts = { ...snapshot.replyDrafts };
  if (body === "") delete drafts[String(threadId)];
  else drafts[String(threadId)] = body;
  writeSnapshot({ ...snapshot, replyDrafts: drafts });
}

/** Clear all persisted session snapshots (the "Clear local drafts" action). */
export function clearSnapshots(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}
