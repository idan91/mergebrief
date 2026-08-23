// The machinery every session write shares, Hono-free: bind the write to the
// Brief the request names. Failures ride the Result — the handler owns the
// wire posture.
import {
  createTenantRepository,
  type RepoId,
  type ReviewerId,
  type SessionWriter,
  type TenantContext,
} from "persistence";
import type { Logger } from "logging";
import type { Result } from "types";
import type { AuthRouteDeps } from "../../../auth/session";
import type { BriefSpan } from "./schemas";
import {
  loadCarryOverInputs,
  resolveSessionTarget,
} from "./logic/brief-target";
import { UnreadableBriefError } from "./logic/carry-over-inputs";
import type { SessionWriteFailure } from "./types";

/** A write bound to the named Brief and reviewer; it writes if needed. */
export type SessionWrite = <T>(
  write: (writer: SessionWriter) => Promise<T>,
) => Promise<Result<T, SessionWriteFailure>>;

export interface ResolvedSessionWrite {
  readonly run: SessionWrite;
  /** The named Brief's head — the commit the reviewer read, and the one a
   * GitHub write pins to. */
  readonly head: string;
}

interface ResolveWriteInput {
  readonly ctx: TenantContext;
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
   * Resolve the PR and the Brief the request names, and bind the write to
   * them. An unknown PR/Brief is `target-not-found` — the subtree's
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
};
