// The Attention List as it arrives on the wire: the three carried kinds, the
// subject each one addresses, and the operations that clear it.
//
// `clearedBy` is read, never inferred: the server sends the operations that
// clear an item precisely so no client has to keep a kind-to-action table of
// its own, and a client that guesses drifts the moment a kind gains one.
import { CommentAnchorKinds, type ValueOf } from "types";

/**
 * The displayed kind. `missing-evidence` is the persistence vocabulary's own
 * token rather than a new name: a carried decision whose evidence target is
 * gone lands in exactly the condition the submit list already names.
 */
export const AttentionItemKinds = {
  ORPHANED_ANCHOR: "orphaned-anchor",
  REOPENED_DISPOSITION: "reopened-disposition",
  MISSING_EVIDENCE: "missing-evidence",
} as const;
export type AttentionItemKind = ValueOf<typeof AttentionItemKinds>;

export const AttentionSubjectTypes = {
  DRAFT_COMMENT: "draft-comment",
  DISPOSITION: "disposition",
} as const;
export type AttentionSubjectType = ValueOf<typeof AttentionSubjectTypes>;

/** `disposition.carry_status`: the carry-over verdict on a carried row. */
export const DispositionCarryStatuses = {
  NEW: "new",
  REOPENED: "reopened",
  SETTLED: "settled",
  DROPPED: "dropped",
} as const;
export type DispositionCarryStatus = ValueOf<typeof DispositionCarryStatuses>;

export interface SessionLineAttentionLocation {
  kind: typeof CommentAnchorKinds.LINE;
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface SessionFileAttentionLocation {
  kind: typeof CommentAnchorKinds.FILE;
  filePath: string;
}

export type SessionAttentionLocation =
  | SessionLineAttentionLocation
  | SessionFileAttentionLocation;

export interface SessionAttentionItem {
  kind: AttentionItemKind;
  subject: {
    type: AttentionSubjectType;
    /** A draft comment always names its row; null on a disposition. */
    id: string | null;
    /** The flag's attribute, on a disposition only. */
    attribute: string | null;
  };
  location: SessionAttentionLocation;
  /** Non-empty: an item nothing can clear is not an item. */
  clearedBy: string[];
}

const KINDS = new Set<string>(Object.values(AttentionItemKinds));
const SUBJECT_TYPES = new Set<string>(Object.values(AttentionSubjectTypes));
const CARRY_STATUSES = new Set<string>(Object.values(DispositionCarryStatuses));

export function isCarryStatus(value: unknown): value is DispositionCarryStatus {
  return typeof value === "string" && CARRY_STATUSES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSubject(value: unknown): value is SessionAttentionItem["subject"] {
  return (
    isRecord(value) &&
    typeof value["type"] === "string" &&
    SUBJECT_TYPES.has(value["type"]) &&
    (value["id"] === null || typeof value["id"] === "string") &&
    (value["attribute"] === null || typeof value["attribute"] === "string")
  );
}

function isLocation(value: unknown): value is SessionAttentionItem["location"] {
  if (!isRecord(value)) return false;
  if (typeof value["filePath"] !== "string") return false;
  if (value["kind"] === CommentAnchorKinds.FILE) return true;
  return (
    value["kind"] === CommentAnchorKinds.LINE &&
    isLine(value["startLine"]) &&
    isLine(value["endLine"])
  );
}

export function isAttentionItem(value: unknown): value is SessionAttentionItem {
  return (
    isRecord(value) &&
    typeof value["kind"] === "string" &&
    KINDS.has(value["kind"]) &&
    isSubject(value["subject"]) &&
    isLocation(value["location"]) &&
    Array.isArray(value["clearedBy"]) &&
    value["clearedBy"].length > 0 &&
    value["clearedBy"].every((id) => typeof id === "string")
  );
}
