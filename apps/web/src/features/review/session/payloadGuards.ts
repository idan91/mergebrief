// Boundary guards for the session read's wire payload. A malformed payload
// FAILS whole rather than degrading item-by-item: a silently dropped draft is
// a comment the reviewer writes a second time.
import { Categories } from "../../brief/types";
import { isRecord } from "@web/utils/typeGuards";
import type { CommentSide } from "../utils/comments";
import type { ReviewComment } from "../utils/comments";
import type { ReviewOutcome, RiskEvidence } from "../utils/state";
import { isCarryStatus } from "./attention";
import type {
  SessionCarriedFrom,
  SessionDisposition,
  SessionDraftComment,
  SessionReclassification,
} from "./serverState";

// The sets take arbitrary strings at `.has` (the input is unvalidated wire
// bytes), but every VALUE is pinned to its vocabulary type by `satisfies`:
// a renamed or added literal fails the build.
const DRAFT_STATUSES = new Set<string>([
  "draft",
  "submitted",
] satisfies ReviewComment["status"][]);
const SIDES = new Set<string>(["old", "new"] satisfies CommentSide[]);
const DECISIONS = new Set<string>([
  "addressed",
  "dismissed",
] satisfies SessionDisposition["decision"][]);
const EVIDENCE_KINDS = new Set<string>([
  "linked-comment",
  "chunk-reviewed",
  "manual-note",
] satisfies RiskEvidence["kind"][]);
const CATEGORIES = new Set<string>(Object.values(Categories));

function isLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isReviewOutcome(value: unknown): value is ReviewOutcome {
  return (
    value === "comment" || value === "approve" || value === "request-changes"
  );
}

function isSide(value: unknown): boolean {
  return typeof value === "string" && SIDES.has(value);
}

/** `startSide` is present only on a crossing range; absent is the normal case. */
function isAbsentOrSide(value: unknown): boolean {
  return value === undefined || isSide(value);
}

export function isDraftComment(value: unknown): value is SessionDraftComment {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string") return false;
  if (typeof value["filePath"] !== "string") return false;
  if (typeof value["body"] !== "string") return false;

  if (typeof value["status"] !== "string") return false;
  if (!DRAFT_STATUSES.has(value["status"])) return false;

  if (value["kind"] === "file") return true;
  if (value["kind"] !== "line") return false;

  if (!isSide(value["side"])) return false;
  if (!isAbsentOrSide(value["startSide"])) return false;

  return isLine(value["startLine"]) && isLine(value["endLine"]);
}

export function isEvidence(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;

  if (typeof value["kind"] !== "string") return false;
  if (!EVIDENCE_KINDS.has(value["kind"])) return false;

  return value["ref"] === null || typeof value["ref"] === "string";
}

export function isDisposition(value: unknown): value is SessionDisposition {
  if (!isRecord(value)) return false;
  if (typeof value["filePath"] !== "string") return false;
  if (typeof value["attribute"] !== "string") return false;
  if (!isLine(value["regionStart"])) return false;
  if (!isLine(value["regionEnd"])) return false;

  if (typeof value["decision"] !== "string") return false;
  if (!DECISIONS.has(value["decision"])) return false;

  const reason = value["reason"];
  if (reason !== null && typeof reason !== "string") return false;

  const carryStatus = value["carryStatus"];
  if (carryStatus !== null && !isCarryStatus(carryStatus)) return false;

  return isEvidence(value["evidence"]);
}

/** A count off the wire: an integer at or above the floor the field states. */
function isCountAtLeast(value: unknown, floor: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= floor;
}

export function isCarriedFrom(value: unknown): value is SessionCarriedFrom {
  if (!isRecord(value)) return false;
  if (typeof value["sessionId"] !== "string") return false;
  if (typeof value["headSha"] !== "string") return false;

  return (
    isCountAtLeast(value["revisions"], 1) && isCountAtLeast(value["items"], 0)
  );
}

export function isReclassification(
  value: unknown,
): value is SessionReclassification {
  return (
    isRecord(value) &&
    typeof value["changeGroupId"] === "string" &&
    typeof value["category"] === "string" &&
    CATEGORIES.has(value["category"])
  );
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((it) => typeof it === "string");
}

export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every((item) => guard(item));
}
