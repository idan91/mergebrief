// The store's session operations bound to the Brief a request names and the
// reviewer making it. The session writes, post-now and the review submit all
// write through here, so whichever lands first creates the session and copies
// the carried work in one transaction. Refusals ride the Result whole.
import type { Logger } from "logging";
import {
  createTenantRepository,
  ReviewSessionErrorCodes,
  type ChunkReadInput,
  type DispositionAnchor,
  type DispositionInput,
  type DraftAnchor,
  type DraftClaim,
  type GroupReclassificationInput,
  type NewDraft,
  type ReleaseClaimInput,
  type ReviewDraftCommentRow,
  type ReviewGroupReclassificationRow,
  type ReviewSessionError,
  type ReviewSessionKey,
  type ReviewSessionRow,
  type ReviewSessionView,
  type ReviewSubmittedReviewRow,
  type SessionOperationResult,
  type SettleClaimInput,
} from "persistence";
import type { ReviewOutcome } from "types/reviews";
import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../../access/types";
import { FailureKinds } from "../../../../../shared-errors/failures";
import type { BriefSpan } from "../schemas";
import type {
  ExistingSessionWriteFailure,
  HeldDraft,
  SessionStoreDeps,
  SessionTargetNotFoundFailure,
  SessionWriteFailure,
} from "../types";
import { findSessionTarget, type SessionTarget } from "./brief-target";

/** A store operation's outcome with its refusal wrapped for the caller. */
type SessionWriteResult<Value> = Result<Value, SessionWriteFailure>;

type DraftWriteResult = SessionWriteResult<ReviewDraftCommentRow>;

/** The store's draft operations, bound to the named Brief and reviewer. */
export interface SessionDraftWrites {
  add(draft: NewDraft): Promise<DraftWriteResult>;
  edit(draftId: bigint, body: string): Promise<DraftWriteResult>;
  reanchor(draftId: bigint, anchor: DraftAnchor): Promise<DraftWriteResult>;
  delete(draftId: bigint): Promise<DraftWriteResult>;
}

/** The reviewer's work on the Brief, bound the same way. */
export interface SessionWorkWrites {
  setChunkRead(
    input: ChunkReadInput,
  ): Promise<SessionWriteResult<ChunkReadInput>>;
  reclassifyGroup(
    input: GroupReclassificationInput,
  ): Promise<SessionWriteResult<ReviewGroupReclassificationRow>>;
  decideRisks(
    decisions: readonly DispositionInput[],
  ): Promise<SessionWriteResult<number>>;
  reopenRisks(
    anchors: readonly DispositionAnchor[],
  ): Promise<SessionWriteResult<number>>;
  setOutcome(
    outcome: ReviewOutcome,
  ): Promise<SessionWriteResult<ReviewSessionRow>>;
}

/** What publishing reads and records on the session, bound the same way. */
export interface SessionPublishWrites {
  /** The drafts a publish would take, read without creating the session. */
  readDrafts(): Promise<SessionWriteResult<readonly HeldDraft[]>>;
  /** Saved before GitHub is called; a refusal leaves no session behind. */
  claim(draftIds: readonly bigint[]): Promise<SessionWriteResult<DraftClaim>>;
  settle(input: SettleClaimInput): Promise<SessionWriteResult<number>>;
  release(input: ReleaseClaimInput): Promise<SessionWriteResult<number>>;
}

export interface ResolvedSessionWrite {
  readonly drafts: SessionDraftWrites;
  readonly work: SessionWorkWrites;
  readonly publish: SessionPublishWrites;
  /** The named Brief's head, the commit the reviewer read, and the one a
   * GitHub write pins to. */
  readonly head: string;
}

type OpenSessionWriteResult = Result<
  ResolvedSessionWrite,
  SessionTargetNotFoundFailure
>;

interface SessionRejection {
  readonly ok: false;
  readonly error: SessionWriteFailure;
}

const TARGET_NOT_FOUND = {
  ok: false,
  error: { kind: "target-not-found" },
} as const;

/** A refusal the store rides back whole, logged when the Brief is at fault. */
export function rejectSession(
  log: Logger,
  span: BriefSpan,
  target: SessionTarget,
  error: ReviewSessionError,
): SessionRejection {
  if (error.code === ReviewSessionErrorCodes.BRIEF_UNREADABLE) {
    log.error("brief artifact unreadable, carry-over not evaluated", {
      briefId: String(target.briefId),
      head: span.head,
    });
  }
  return { ok: false, error: { kind: FailureKinds.SESSION_REJECTED, error } };
}

/** The store, the session key and the refusal wrapper every binding shares. */
interface SessionBinding {
  readonly sessions: ReturnType<
    typeof createTenantRepository
  >["reviewSessions"];
  readonly key: ReviewSessionKey;
  settle<Value>(
    this: void,
    done: SessionOperationResult<Value>,
  ): SessionWriteResult<Value>;
}

function bindSession(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  span: BriefSpan,
  target: SessionTarget,
): SessionBinding {
  return {
    sessions: createTenantRepository(deps.handle, access.rowScope)
      .reviewSessions,
    key: { briefId: target.briefId, reviewerId: access.session.reviewerId },
    settle(done) {
      if (!done.ok) {
        return rejectSession(deps.log, span, target, done.error);
      }
      return done;
    },
  };
}

function bindDraftWrites({
  sessions,
  key,
  settle,
}: SessionBinding): SessionDraftWrites {
  return {
    add: async (draft) => settle(await sessions.addDraft(key, draft)),
    edit: async (draftId, body) =>
      settle(await sessions.editDraft(key, draftId, body)),
    reanchor: async (draftId, anchor) =>
      settle(await sessions.reanchorDraft(key, draftId, anchor)),
    delete: async (draftId) => settle(await sessions.deleteDraft(key, draftId)),
  };
}

function bindWorkWrites({
  sessions,
  key,
  settle,
}: SessionBinding): SessionWorkWrites {
  return {
    setChunkRead: async (read) =>
      settle(await sessions.setChunkRead(key, read)),
    reclassifyGroup: async (reclassification) =>
      settle(await sessions.reclassifyGroup(key, reclassification)),
    decideRisks: async (decisions) =>
      settle(await sessions.decideRisks(key, decisions)),
    reopenRisks: async (anchors) =>
      settle(await sessions.reopenRisks(key, anchors)),
    setOutcome: async (outcome) =>
      settle(await sessions.setOutcome(key, outcome)),
  };
}

/** The session's own drafts, or before it exists, the ones it would carry. */
function readHeldDrafts(view: ReviewSessionView): readonly HeldDraft[] {
  if (view.session !== undefined) {
    return view.session.draftComments;
  }
  return view.carried.draftComments.map((draft) => ({
    ...draft,
    publishClaim: null,
    publishClaimedAt: null,
  }));
}

function bindPublishWrites({
  sessions,
  key,
  settle,
}: SessionBinding): SessionPublishWrites {
  return {
    readDrafts: async () => {
      const view = settle(await sessions.preview(key));
      if (!view.ok) {
        return view;
      }
      return { ok: true, value: readHeldDrafts(view.value) };
    },
    claim: async (draftIds) =>
      settle(await sessions.claimDrafts(key, { draftIds })),
    settle: async (input) => settle(await sessions.settleClaim(key, input)),
    release: async (input) => settle(await sessions.releaseClaim(key, input)),
  };
}

/**
 * Bind every write to the Brief `span` names on the access step's row. An
 * unknown Brief is `target-not-found`; the subtree's hint-free 404 is the
 * caller's judgment.
 */
export async function openSessionWrite(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  span: BriefSpan,
): Promise<OpenSessionWriteResult> {
  const target = await findSessionTarget(deps.handle, access, span);
  if (target === undefined) {
    return TARGET_NOT_FOUND;
  }

  const binding = bindSession(deps, access, span, target);
  return {
    ok: true,
    value: {
      head: span.head,
      drafts: bindDraftWrites(binding),
      work: bindWorkWrites(binding),
      publish: bindPublishWrites(binding),
    },
  };
}

/**
 * Record a reply's wrapping review on a session that already exists, and
 * nothing when none does. A first write materializes the session and carries
 * the previous one's work across, which only the reviewer's own review work
 * may set off.
 */
export async function recordSessionReplyReview(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  span: BriefSpan,
  githubReviewId: bigint,
): Promise<Result<ReviewSubmittedReviewRow, ExistingSessionWriteFailure>> {
  const target = await findSessionTarget(deps.handle, access, span);
  if (target === undefined) {
    return TARGET_NOT_FOUND;
  }

  const { sessions, key, settle } = bindSession(deps, access, span, target);
  const recorded = await sessions.recordReplyReview(key, githubReviewId);
  const noSession =
    !recorded.ok &&
    recorded.error.code === ReviewSessionErrorCodes.SESSION_NOT_FOUND;
  if (noSession) {
    return { ok: false, error: { kind: "no-session" } };
  }
  return settle(recorded);
}
