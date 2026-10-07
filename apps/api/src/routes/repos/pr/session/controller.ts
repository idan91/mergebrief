// The machinery every session write shares, Hono-free: bind the write to the
// Brief the request names. Failures ride the Result, the handler owns the
// wire posture.
import {
  createTenantRepository,
  ReviewSessionErrorCodes,
  type ChunkReadInput,
  type DispositionAnchor,
  type DispositionInput,
  type DraftAnchor,
  type GroupReclassificationInput,
  type NewDraft,
  type PublishedDraftsInput,
  type RepoId,
  type ReviewDraftCommentRow,
  type ReviewerId,
  type ReviewGroupReclassificationRow,
  type ReviewSessionError,
  type ReviewSessionKey,
  type ReviewSessionRow,
  type ReviewSubmittedReviewRow,
  type ScopeContext,
  type SessionOperationResult,
} from "persistence";
import type { Logger } from "logging";
import type { ReviewOutcome } from "types/reviews";
import type { Result } from "types/utils";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { BriefSpan } from "./schemas";
import { resolveSessionTarget, type SessionTarget } from "./logic/brief-target";
import type { SessionPayload } from "contract";
import { buildSessionPayload } from "./logic/payload";
import type { SessionWriteFailure } from "./types";
import { FailureKinds } from "../../../../shared-errors/failures";

/** A store operation's outcome with its refusal wrapped for the handler. */
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
  listDrafts(): Promise<SessionWriteResult<readonly ReviewDraftCommentRow[]>>;
  recordPublishedDrafts(
    published: PublishedDraftsInput,
  ): Promise<SessionWriteResult<number>>;
}

export interface ResolvedSessionWrite {
  readonly drafts: SessionDraftWrites;
  readonly work: SessionWorkWrites;
  readonly publish: SessionPublishWrites;
  /** The named Brief's head, the commit the reviewer read, and the one a
   * GitHub write pins to. */
  readonly head: string;
}

interface ResolveWriteInput {
  readonly ctx: ScopeContext;
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly span: BriefSpan;
  readonly reviewerId: ReviewerId;
  readonly log: Logger;
}

type ResolveWriteResult = Result<
  ResolvedSessionWrite,
  { readonly kind: "target-not-found" }
>;

/** Why a write meant only for a session that already exists wrote nothing. */
export type ExistingSessionWriteFailure =
  | { readonly kind: "target-not-found" }
  | { readonly kind: "no-session" }
  | SessionWriteFailure;

type ExistingSessionWriteResult<Written> = Result<
  Written,
  ExistingSessionWriteFailure
>;

type PreviewSessionResult = Result<
  SessionPayload,
  { readonly kind: "target-not-found" } | SessionWriteFailure
>;

/** A refusal the store rides back whole, logged when the Brief is at fault. */
function rejectSession(
  input: ResolveWriteInput,
  target: SessionTarget,
  error: ReviewSessionError,
): { readonly ok: false; readonly error: SessionWriteFailure } {
  if (error.code === ReviewSessionErrorCodes.BRIEF_UNREADABLE) {
    input.log.error("brief artifact unreadable, carry-over not evaluated", {
      briefId: String(target.briefId),
      head: input.span.head,
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
  deps: AuthRouteDeps,
  input: ResolveWriteInput,
  target: SessionTarget,
): SessionBinding {
  return {
    sessions: createTenantRepository(deps.handle, input.ctx).reviewSessions,
    key: { briefId: target.briefId, reviewerId: input.reviewerId },
    settle(done) {
      if (!done.ok) {
        return rejectSession(input, target, done.error);
      }
      return done;
    },
  };
}

/** Bind the store's draft operations; refusals ride the Result whole. */
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

function bindPublishWrites({
  sessions,
  key,
  settle,
}: SessionBinding): SessionPublishWrites {
  return {
    listDrafts: async () => settle(await sessions.listDrafts(key)),
    recordPublishedDrafts: async (published) =>
      settle(await sessions.recordPublishedDrafts(key, published)),
  };
}

export const sessionController = {
  /**
   * The session read. PURE: it NEVER creates a session. Before the first
   * write the payload carries the carry-over verdicts evaluated in memory
   * (`preview`), still writing nothing.
   */
  async previewSession(deps: AuthRouteDeps, input: ResolveWriteInput) {
    const target = await resolveSessionTarget(
      deps,
      input.ctx,
      input.repoId,
      input.prNumber,
      input.span,
    );

    if (target === undefined) {
      return {
        ok: false,
        error: { kind: "target-not-found" },
      } satisfies PreviewSessionResult;
    }

    const view = await createTenantRepository(
      deps.handle,
      input.ctx,
    ).reviewSessions.preview({
      briefId: target.briefId,
      reviewerId: input.reviewerId,
    });
    if (!view.ok) {
      return rejectSession(
        input,
        target,
        view.error,
      ) satisfies PreviewSessionResult;
    }
    return {
      ok: true,
      value: buildSessionPayload(view.value, target.headIndex),
    } satisfies PreviewSessionResult;
  },

  /**
   * Resolve the PR and the Brief the request names, and bind the write to
   * them. An unknown PR/Brief is `target-not-found`, the subtree's
   * hint-free 404 is the handler's judgment.
   */
  async resolveWrite(deps: AuthRouteDeps, input: ResolveWriteInput) {
    const target = await resolveSessionTarget(
      deps,
      input.ctx,
      input.repoId,
      input.prNumber,
      input.span,
    );
    if (target === undefined) {
      return {
        ok: false,
        error: { kind: "target-not-found" },
      } satisfies ResolveWriteResult;
    }
    const binding = bindSession(deps, input, target);
    return {
      ok: true,
      value: {
        head: input.span.head,
        drafts: bindDraftWrites(binding),
        work: bindWorkWrites(binding),
        publish: bindPublishWrites(binding),
      },
    } satisfies ResolveWriteResult;
  },

  /**
   * Record a reply's wrapping review on a session that already exists, and
   * nothing when none does. A first write materializes the session and
   * carries the previous one's work across, which only the reviewer's own
   * review work may set off.
   */
  async recordReplyReview(
    deps: AuthRouteDeps,
    input: ResolveWriteInput,
    githubReviewId: bigint,
  ): Promise<ExistingSessionWriteResult<ReviewSubmittedReviewRow>> {
    const target = await resolveSessionTarget(
      deps,
      input.ctx,
      input.repoId,
      input.prNumber,
      input.span,
    );
    if (target === undefined) {
      return { ok: false, error: { kind: "target-not-found" } };
    }

    const { sessions, key, settle } = bindSession(deps, input, target);
    const recorded = await sessions.recordReplyReview(key, githubReviewId);
    if (
      !recorded.ok &&
      recorded.error.code === ReviewSessionErrorCodes.SESSION_NOT_FOUND
    ) {
      return { ok: false, error: { kind: "no-session" } };
    }
    return settle(recorded);
  },
};
