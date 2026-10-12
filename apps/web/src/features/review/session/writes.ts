// Send one request per action; never queue or retry it implicitly.
// Snapshot PUTs would clobber concurrent fields and erase per-operation audit/scope checks.
// Bulk dismiss/address is one operation carrying ids, not a batch of separate writes.
import type {
  ChangeGroupCategory,
  CommentAnchorKinds,
  DiffSide,
  Mutable,
  ReviewOutcome,
} from "types";
import type { TranslationKey } from "i18n";

import {
  ApiErrorCodes,
  apiFetch,
  errorFromResponse,
  type ApiErrorCode,
  type ApiFetchInit,
} from "../../../data/apiFetch";
import type { RiskEvidence } from "../utils/state";

/** The Brief a write names, the same span the session read took. */
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
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: "review.writeError.draftLimit",
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]: "review.writeError.recordLimit",
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: "review.writeError.alreadyPublished",
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: "review.writeError.publishPending",
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]: "review.writeError.publishInDoubt",
  [ApiErrorCodes.HUMAN_ONLY]: "review.writeError.humanOnly",
  [ApiErrorCodes.UNAUTHORIZED]: "review.writeError.unauthorized",
  [ApiErrorCodes.SIGNED_OUT]: "review.writeError.unauthorized",
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

export interface LineDraftAnchorWire {
  kind?: typeof CommentAnchorKinds.LINE;
  filePath: string;
  side: DiffSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: DiffSide;
  startLine: number;
  endLine: number;
}

export interface FileDraftAnchorWire {
  kind: typeof CommentAnchorKinds.FILE;
  filePath: string;
}

export type DraftAnchorWire = LineDraftAnchorWire | FileDraftAnchorWire;

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
  reclassify(
    groupId: string,
    category: ChangeGroupCategory,
  ): Promise<SessionWriteResult>;
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
    code === ApiErrorCodes.PR_CHANGED_SINCE_READ ||
    code === ApiErrorCodes.PR_REWRITTEN_SINCE_READ
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
 * One operation. A non-2xx is an EXPECTED outcome the caller reverts on,
 * never a throw, and a thrown fetch is the same indeterminate failure: the
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
  try {
    const init: Mutable<ApiFetchInit> = {
      method,
      headers: { "content-type": "application/json" },
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    response = await apiFetch(path, init);
  } catch {
    return { ok: false, failure: UNKNOWN };
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
  // A 2xx with no id is a contract violation, but the write DID land, the
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
