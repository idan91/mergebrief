import type { Category } from "../../brief/types";
import type { ReviewComment } from "../comments";
import type { ReviewOutcome } from "../state";
import type { Disposition } from "./disposition";
import type { CheckBucket, MindMapState } from "./store";

/**
 * The frozen, serializable session snapshot persisted per brief to
 * sessionStorage — Sets flattened to arrays. This is also the input the Receipt
 * builder (Slice E) consumes. Persists more than the old DemoReviewSnapshot
 * (dominants, reclassifications, playbook checks now survive refresh) and drops
 * reviewMode (now local UI). The `v2` key avoids colliding with old `v1` data.
 */
export interface SessionSnapshot {
  briefId: string;
  dispositions: Record<string, Disposition>;
  dominants: Record<string, Category>;
  reclassifiedGroupIds: string[];
  reviewedChunkIds: string[];
  checkedItems: Record<CheckBucket, number[]>;
  reviewComments: ReviewComment[];
  reviewOutcome: ReviewOutcome;
}

const STORAGE_KEY = "code-review:session:v2";
const MAX_SNAPSHOTS = 12;

export function serializeSnapshot(
  briefId: string,
  state: MindMapState,
): SessionSnapshot {
  // Template-literal-keyed record can't be built from dynamic keys without an
  // assertion; the keys come straight from the in-memory CheckBucket record.
  const checkedItems = Object.fromEntries(
    Object.entries(state.checkedItems).map(([bucket, indexes]) => [
      bucket,
      [...indexes],
    ]),
  ) as Record<CheckBucket, number[]>;
  return {
    briefId,
    dispositions: state.dispositions,
    dominants: state.dominants,
    reclassifiedGroupIds: [...state.reclassifiedGroups],
    reviewedChunkIds: [...state.reviewedChunks],
    checkedItems,
    reviewComments: state.reviewComments,
    reviewOutcome: state.reviewOutcome,
  };
}

export function snapshotToState(snapshot: SessionSnapshot): MindMapState {
  const checkedItems = Object.fromEntries(
    Object.entries(snapshot.checkedItems).map(([bucket, indexes]) => [
      bucket,
      new Set(indexes),
    ]),
  ) as Record<CheckBucket, Set<number>>;
  return {
    dispositions: snapshot.dispositions,
    dominants: snapshot.dominants,
    reclassifiedGroups: new Set(snapshot.reclassifiedGroupIds),
    reviewedChunks: new Set(snapshot.reviewedChunkIds),
    checkedItems,
    reviewComments: snapshot.reviewComments,
    reviewOutcome: snapshot.reviewOutcome,
  };
}

const REVIEW_OUTCOMES: readonly string[] = [
  "comment",
  "approve",
  "request-changes",
] satisfies readonly ReviewOutcome[];
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

function isNumberArrayRecord(value: unknown): boolean {
  return (
    isObject(value) &&
    Object.values(value).every(
      (entry) =>
        Array.isArray(entry) && entry.every((item) => typeof item === "number"),
    )
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
    isNumberArrayRecord(value["checkedItems"]) &&
    Array.isArray(value["reviewComments"]) &&
    value["reviewComments"].every(isReviewComment) &&
    typeof value["reviewOutcome"] === "string" &&
    REVIEW_OUTCOMES.includes(value["reviewOutcome"])
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

/** Clear all persisted session snapshots (the "Clear local drafts" action). */
export function clearSnapshots(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}
