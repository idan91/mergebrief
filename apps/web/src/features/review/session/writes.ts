// Send one request per action; never queue or retry it implicitly.
// Snapshot PUTs would clobber concurrent fields and erase per-operation audit/scope checks.
// Bulk dismiss/address is one operation carrying ids, not a batch of separate writes.
import {
  ProductActionIds,
  type AddressRiskBody,
  type CreateDraftCommentBody,
  type CreateDraftCommentResponse,
  type DismissRiskBody,
  type DraftAnchorWire,
  type EvidencedFlagAnchorWire,
  type FlagAnchorWire,
  type ReclassifyGroupBody,
  type ReopenRiskBody,
  type RiskWriteResponse,
  type SetReviewOutcomeBody,
  type UpdateDraftCommentBody,
} from "contract";
import type { ChangeGroupCategory, ReviewOutcome } from "types";
import type { TranslationKey } from "i18n";

import {
  ApiErrorCodes,
  apiFetch,
  errorFromResponse,
  isSignInRequired,
  type ApiErrorCode,
  type ApiFetchInit,
} from "../../../data/apiFetch";
import { readFailureKind, request } from "../../../data/request";
import type { WriteKindTable } from "../../../data/request/types";
import { createDraftResponseSchema, riskWriteResponseSchema } from "./schemas";
import {
  SessionWriteFailureKinds,
  type SessionWriteFailureKind,
} from "./types";

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

const SessionWriteKinds: WriteKindTable<SessionWriteFailureKind> = {
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: SessionWriteFailureKinds.FROZEN,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: SessionWriteFailureKinds.FROZEN,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: SessionWriteFailureKinds.DRAFT_LIMIT,
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]:
    SessionWriteFailureKinds.RECORD_LIMIT,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]:
    SessionWriteFailureKinds.ALREADY_PUBLISHED,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]:
    SessionWriteFailureKinds.PUBLISH_PENDING,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]:
    SessionWriteFailureKinds.PUBLISH_IN_DOUBT,
  [ApiErrorCodes.HUMAN_ONLY]: SessionWriteFailureKinds.HUMAN_ONLY,
  [ApiErrorCodes.MALFORMED]: SessionWriteFailureKinds.INDETERMINATE,
  fallback: SessionWriteFailureKinds.FAILED,
};

/** `failed` and `indeterminate` share copy: a throw can land after the write applied. */
const SESSION_WRITE_FAILURE_KEYS = {
  [SessionWriteFailureKinds.FROZEN]: "review.writeError.frozen",
  [SessionWriteFailureKinds.DRAFT_LIMIT]: "review.writeError.draftLimit",
  [SessionWriteFailureKinds.RECORD_LIMIT]: "review.writeError.recordLimit",
  [SessionWriteFailureKinds.ALREADY_PUBLISHED]:
    "review.writeError.alreadyPublished",
  [SessionWriteFailureKinds.PUBLISH_PENDING]:
    "review.writeError.publishPending",
  [SessionWriteFailureKinds.PUBLISH_IN_DOUBT]:
    "review.writeError.publishInDoubt",
  [SessionWriteFailureKinds.HUMAN_ONLY]: "review.writeError.humanOnly",
  [SessionWriteFailureKinds.FAILED]: "review.writeError.failed",
  [SessionWriteFailureKinds.UNAUTHORIZED]: "review.writeError.unauthorized",
  [SessionWriteFailureKinds.INDETERMINATE]: "review.writeError.failed",
} as const satisfies Record<SessionWriteFailureKind, TranslationKey>;

/** Every session operation, one method each. */
export interface SessionWrites {
  setRead(chunkId: string, read: boolean): Promise<SessionWriteResult>;
  reclassify(
    groupId: string,
    category: ChangeGroupCategory,
  ): Promise<SessionWriteResult>;
  createDraft(
    draft: CreateDraftCommentBody,
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
    flags: readonly EvidencedFlagAnchorWire[],
  ): Promise<SessionWriteResult>;
  reopenRisks(flags: readonly FlagAnchorWire[]): Promise<SessionWriteResult>;
  setOutcome(outcome: ReviewOutcome): Promise<SessionWriteResult>;
}

function resolveFailure(kind: SessionWriteFailureKind): SessionWriteFailure {
  return {
    frozen: kind === SessionWriteFailureKinds.FROZEN,
    copy: SESSION_WRITE_FAILURE_KEYS[kind],
  };
}

const UNKNOWN = resolveFailure(SessionWriteFailureKinds.INDETERMINATE);

/**
 * A non-2xx is an EXPECTED outcome the caller reverts on, never a throw. A
 * 2xx whose body will not read is the same indeterminate failure as a thrown
 * fetch: the reviewer is told, and the action stays available.
 */
async function settleSessionWrite<Value>(
  send: () => Promise<Value>,
): Promise<SessionWriteResult<Value>> {
  try {
    return { ok: true, value: await send() };
  } catch (error) {
    const kind = readFailureKind(error, SessionWriteKinds);
    return { ok: false, failure: resolveFailure(kind) };
  }
}

function readDraftId(
  result: SessionWriteResult<CreateDraftCommentResponse>,
): SessionWriteResult<string> {
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: result.value.draftId };
}

/** The count is read so an off-shape 2xx is caught; no caller needs the number. */
function dropCount(
  result: SessionWriteResult<RiskWriteResponse>,
): SessionWriteResult {
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: undefined };
}

function buildChunkReadFailure(code: ApiErrorCode): SessionWriteFailure {
  if (isSignInRequired(code)) {
    return resolveFailure(SessionWriteFailureKinds.UNAUTHORIZED);
  }
  return resolveFailure(SessionWriteKinds[code] ?? SessionWriteKinds.fallback);
}

/** `set-chunk-read`'s own request, until it splits into a pair of operations. */
async function sendChunkRead(
  target: SessionWriteTarget,
  chunkId: string,
  read: boolean,
): Promise<SessionWriteResult> {
  const span = `base=${encodeURIComponent(target.base)}&head=${encodeURIComponent(target.head)}`;
  const path = `/api/repos/${encodeURIComponent(target.repoId)}/pulls/${String(target.prNumber)}/session/chunks/${encodeURIComponent(chunkId)}/read?${span}`;
  let response: Response;
  try {
    const init: ApiFetchInit = {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read }),
    };
    response = await apiFetch(path, init);
  } catch {
    return { ok: false, failure: UNKNOWN };
  }
  if (!response.ok) {
    const { code } = await errorFromResponse(response, path);
    return { ok: false, failure: buildChunkReadFailure(code) };
  }
  try {
    await response.json();
  } catch {
    return { ok: false, failure: UNKNOWN };
  }
  return { ok: true, value: undefined };
}

export function createSessionWrites(target: SessionWriteTarget): SessionWrites {
  const params = { repoId: target.repoId, prNumber: target.prNumber };
  const query = { base: target.base, head: target.head };

  return {
    setRead: (chunkId, read) => sendChunkRead(target, chunkId, read),
    reclassify(groupId, category) {
      const body: ReclassifyGroupBody = { category };
      return settleSessionWrite(async () => {
        await request(ProductActionIds.RECLASSIFY_GROUP, {
          query,
          params: { ...params, groupId },
          body,
        });
      });
    },
    createDraft: (draft) =>
      settleSessionWrite(() =>
        request(
          ProductActionIds.CREATE_DRAFT_COMMENT,
          { query, params, body: draft },
          createDraftResponseSchema,
        ),
      ).then(readDraftId),
    updateDraft(draftId, text) {
      const body: UpdateDraftCommentBody = { body: text };
      return settleSessionWrite(async () => {
        await request(ProductActionIds.UPDATE_DRAFT_COMMENT, {
          query,
          params: { ...params, draftId },
          body,
        });
      });
    },
    reanchorDraft: (draftId, anchor) =>
      settleSessionWrite(async () => {
        await request(ProductActionIds.REANCHOR_DRAFT_COMMENT, {
          query,
          params: { ...params, draftId },
          body: anchor,
        });
      }),
    deleteDraft: (draftId) =>
      settleSessionWrite(async () => {
        await request(ProductActionIds.DELETE_DRAFT_COMMENT, {
          query,
          params: { ...params, draftId },
        });
      }),
    dismissRisks(flags, reason) {
      const body: DismissRiskBody = { flags, reason };
      return settleSessionWrite(() =>
        request(
          ProductActionIds.DISMISS_RISK,
          { query, params, body },
          riskWriteResponseSchema,
        ),
      ).then(dropCount);
    },
    addressRisks(flags) {
      const body: AddressRiskBody = { flags };
      return settleSessionWrite(() =>
        request(
          ProductActionIds.ADDRESS_RISK,
          { query, params, body },
          riskWriteResponseSchema,
        ),
      ).then(dropCount);
    },
    reopenRisks(flags) {
      const body: ReopenRiskBody = { flags };
      return settleSessionWrite(() =>
        request(
          ProductActionIds.REOPEN_RISK,
          { query, params, body },
          riskWriteResponseSchema,
        ),
      ).then(dropCount);
    },
    setOutcome(outcome) {
      const body: SetReviewOutcomeBody = { outcome };
      return settleSessionWrite(async () => {
        await request(ProductActionIds.SET_REVIEW_OUTCOME, {
          query,
          params,
          body,
        });
      });
    },
  };
}
