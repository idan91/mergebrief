// The Review Session write transport: ONE request per user action, no
// batching, no network debounce, no retry machinery. A retry here is the
// action again — so every call either lands or is reported, and nothing is
// queued for later.
//
// Never a snapshot PUT: a whole-session write clobbers a concurrent writer's
// untouched fields, leaves the audit trail unable to say what the reviewer
// did, and collapses every action into one scope check. Bulk dismiss/address
// arrive as one call carrying an id array — the operation's shape, not
// batching.
import type { TranslationKey } from "i18n";

import {
  ApiErrorCode,
  apiFetch,
  errorFromResponse,
} from "../../../data/apiFetch";
import type { ReviewOutcome, RiskEvidence } from "../utils/state";
import type { CommentSide } from "../utils/comments";
import type { Category } from "../../brief/types";

/** The Brief a write names — the same span the session read took. */
export interface SessionWriteTarget {
  repoId: string;
  prNumber: number;
  base: string;
  head: string;
}

/**
 * A failed write, as the screen must treat it. `frozen` is TERMINAL for the
 * screen rather than a per-action failure: the reviewer has written against a
 * newer Brief, so every retry fails identically.
 */
export interface SessionWriteFailure {
  readonly frozen: boolean;
  readonly copy: TranslationKey;
}

export type SessionWriteResult<T = void> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SessionWriteFailure };

/** Wire copy per code the session routes can return; the rest is generic. */
const FAILURE_COPY: Partial<Record<ApiErrorCode, TranslationKey>> = {
  [ApiErrorCode.DRAFT_LIMIT_REACHED]: "review.writeError.draftLimit",
  [ApiErrorCode.DRAFT_ALREADY_PUBLISHED]: "review.writeError.alreadyPublished",
  [ApiErrorCode.HUMAN_ONLY]: "review.writeError.humanOnly",
  [ApiErrorCode.UNAUTHORIZED]: "review.writeError.unauthorized",
};

const FROZEN: SessionWriteFailure = {
  frozen: true,
  copy: "review.writeError.frozen",
};

/** Deliberately INDETERMINATE: a throw can land after the write applied. */
const UNKNOWN: SessionWriteFailure = {
  frozen: false,
  copy: "review.writeError.failed",
};

export interface DraftAnchorWire {
  filePath: string;
  side: CommentSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: CommentSide;
  startLine: number;
  endLine: number;
}

export interface FlagAnchorWire {
  filePath: string;
  attribute: string;
  regionStart: number;
  regionEnd: number;
}

export interface EvidenceWire {
  kind: RiskEvidence["kind"];
  ref: string;
}

/** Every session operation, one method each. */
export interface SessionWrites {
  setRead(chunkId: string, read: boolean): Promise<SessionWriteResult>;
  reclassify(groupId: string, category: Category): Promise<SessionWriteResult>;
  createDraft(
    draft: DraftAnchorWire & { body: string },
  ): Promise<SessionWriteResult<string>>;
  updateDraft(draftId: string, body: string): Promise<SessionWriteResult>;
  reanchorDraft(
    draftId: string,
    anchor: DraftAnchorWire,
  ): Promise<SessionWriteResult>;
  deleteDraft(draftId: string): Promise<SessionWriteResult>;
  dismissRisks(
    flags: readonly FlagAnchorWire[],
    reason: string,
  ): Promise<SessionWriteResult>;
  addressRisks(
    flags: readonly (FlagAnchorWire & { evidence: EvidenceWire })[],
  ): Promise<SessionWriteResult>;
  reopenRisks(flags: readonly FlagAnchorWire[]): Promise<SessionWriteResult>;
  setOutcome(outcome: ReviewOutcome): Promise<SessionWriteResult>;
}

function failureFor(code: ApiErrorCode): SessionWriteFailure {
  if (
    code === ApiErrorCode.PR_CHANGED_SINCE_READ ||
    code === ApiErrorCode.PR_REWRITTEN_SINCE_READ
  ) {
    return FROZEN;
  }
  return { frozen: false, copy: FAILURE_COPY[code] ?? UNKNOWN.copy };
}

export function sessionWritePath(
  target: SessionWriteTarget,
  suffix: string,
): string {
  const span = `base=${encodeURIComponent(target.base)}&head=${encodeURIComponent(target.head)}`;
  return `/api/repos/${encodeURIComponent(target.repoId)}/pulls/${String(target.prNumber)}/session${suffix}?${span}`;
}

type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * How many session writes are in flight, process-wide. The focus refetch
 * REPLACES the store, so it must not run against a payload computed before a
 * write this tab has already sent: the reviewer would watch their own action
 * disappear, or see the created draft twice. Not a queue and not a lock —
 * just "not right now".
 */
let inFlight = 0;

export function hasPendingSessionWrite(): boolean {
  return inFlight > 0;
}

/**
 * One operation. A non-2xx is an EXPECTED outcome the caller reverts on —
 * never a throw — and a thrown fetch is the same indeterminate failure: the
 * reviewer is told, and the action stays available.
 */
async function send<T>(
  target: SessionWriteTarget,
  suffix: string,
  method: WriteMethod,
  body: unknown,
  read: (payload: unknown) => T,
): Promise<SessionWriteResult<T>> {
  const path = sessionWritePath(target, suffix);
  let response: Response;
  inFlight += 1;
  try {
    response = await apiFetch(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, failure: UNKNOWN };
  } finally {
    inFlight -= 1;
  }
  if (!response.ok) {
    const { code } = await errorFromResponse(response, path);
    return { ok: false, failure: failureFor(code) };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, failure: UNKNOWN };
  }
  return { ok: true, value: read(payload) };
}

const ignore = (): void => undefined;

function draftId(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "draftId" in payload &&
    typeof payload.draftId === "string"
  ) {
    return payload.draftId;
  }
  // A 2xx with no id is a contract violation, but the write DID land — the
  // caller must not revert. The unusable id keeps post-now off this draft
  // until the next read replaces it.
  return "";
}

export function createSessionWrites(target: SessionWriteTarget): SessionWrites {
  return {
    setRead: (chunkId, read) =>
      send(
        target,
        `/chunks/${encodeURIComponent(chunkId)}/read`,
        "PUT",
        { read },
        ignore,
      ),
    reclassify: (groupId, category) =>
      send(
        target,
        `/groups/${encodeURIComponent(groupId)}/classification`,
        "PUT",
        { category },
        ignore,
      ),
    createDraft: (draft) => send(target, "/comments", "POST", draft, draftId),
    updateDraft: (id, body) =>
      send(
        target,
        `/comments/${encodeURIComponent(id)}`,
        "PATCH",
        { body },
        ignore,
      ),
    reanchorDraft: (id, anchor) =>
      send(
        target,
        `/comments/${encodeURIComponent(id)}/anchor`,
        "PUT",
        anchor,
        ignore,
      ),
    deleteDraft: (id) =>
      send(
        target,
        `/comments/${encodeURIComponent(id)}`,
        "DELETE",
        undefined,
        ignore,
      ),
    dismissRisks: (flags, reason) =>
      send(target, "/risks/dismiss", "POST", { flags, reason }, ignore),
    addressRisks: (flags) =>
      send(target, "/risks/address", "POST", { flags }, ignore),
    reopenRisks: (flags) =>
      send(target, "/risks/reopen", "POST", { flags }, ignore),
    setOutcome: (outcome) =>
      send(target, "/outcome", "PUT", { outcome }, ignore),
  };
}
