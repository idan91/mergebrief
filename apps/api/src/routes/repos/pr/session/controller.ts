// The machinery every session write shares, Hono-free: bind the write to the
// Brief the request names. Failures ride the Result, the handler owns the
// wire posture.
import {
  createTenantRepository,
  type RepoId,
  type ReviewerId,
  type SessionWriter,
  type ScopeContext,
} from "persistence";
import type { Logger } from "logging";
import type { Result } from "types/utils";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { BriefSpan } from "./schemas";
import {
  loadCarryOverInputs,
  resolveSessionTarget,
} from "./logic/brief-target";
import { UnreadableBriefError } from "./logic/carry-over-inputs";
import type { SessionPayload } from "contract";
import { buildSessionPayload } from "./logic/payload";
import type { SessionWriteFailure } from "./types";

/** A write bound to the named Brief and reviewer; it writes if needed. */
export type SessionWrite = <T>(
  write: (writer: SessionWriter) => Promise<T>,
) => Promise<Result<T, SessionWriteFailure>>;

export interface ResolvedSessionWrite {
  readonly run: SessionWrite;
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
  { readonly kind: "target-not-found" } | { readonly kind: "unreadable-brief" }
>;

/**
 * Bind the resolved target into the session-write channel: one writer
 * transaction per call, carry facts loaded lazily, store refusals riding
 * the Result whole.
 */
function bindSessionWriter(
  deps: AuthRouteDeps,
  input: ResolveWriteInput,
  target: NonNullable<Awaited<ReturnType<typeof resolveSessionTarget>>>,
): SessionWrite {
  return async (write) => {
    try {
      const written = await createTenantRepository(
        deps.handle,
        input.ctx,
      ).reviewSessions.writeToSession(
        {
          briefId: target.briefId,
          reviewerId: input.reviewerId,
          brief: () => loadCarryOverInputs(deps, input.ctx, target, input.span),
        },
        write,
      );
      if (!written.ok) {
        return {
          ok: false,
          error: { kind: "session-rejected", error: written.error },
        };
      }
      return written;
    } catch (error) {
      if (!(error instanceof UnreadableBriefError)) throw error;
      input.log.error("brief artifact unreadable — nothing was materialized", {
        briefId: String(target.briefId),
        head: input.span.head,
      });
      return { ok: false, error: { kind: "unreadable-brief" } };
    }
  };
}

export default {
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

    try {
      const view = await createTenantRepository(
        deps.handle,
        input.ctx,
      ).reviewSessions.preview({
        briefId: target.briefId,
        reviewerId: input.reviewerId,
        brief: () => loadCarryOverInputs(deps, input.ctx, target, input.span),
      });
      return {
        ok: true,
        value: buildSessionPayload(view, target.headIndex),
      } satisfies PreviewSessionResult;
    } catch (error) {
      if (!(error instanceof UnreadableBriefError)) throw error;
      input.log.error("brief artifact unreadable — carry-over not evaluated", {
        briefId: String(target.briefId),
        head: input.span.head,
      });
      return {
        ok: false,
        error: { kind: "unreadable-brief" },
      } satisfies PreviewSessionResult;
    }
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
    return {
      ok: true,
      value: {
        head: input.span.head,
        run: bindSessionWriter(deps, input, target),
      },
    } satisfies ResolveWriteResult;
  },

  /**
   * A write for a session that already exists, and a no-op when none does. A
   * first write materializes the session and carries the previous one's work
   * across, which only the reviewer's own review work may set off.
   */
  async writeToExistingSession<Written>(
    deps: AuthRouteDeps,
    input: ResolveWriteInput,
    write: (writer: SessionWriter) => Promise<Written>,
  ): Promise<ExistingSessionWriteResult<Written>> {
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

    const existing = await createTenantRepository(
      deps.handle,
      input.ctx,
    ).reviewSessions.get({
      briefId: target.briefId,
      reviewerId: input.reviewerId,
    });
    if (existing === undefined) {
      return { ok: false, error: { kind: "no-session" } };
    }

    return bindSessionWriter(deps, input, target)(write);
  },
};
