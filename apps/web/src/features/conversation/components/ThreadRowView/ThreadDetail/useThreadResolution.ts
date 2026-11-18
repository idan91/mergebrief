import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";
// Thread-resolution facade: ThreadDetail wires the transport in, this hook
// owns pending/error/copy for both entry points: the standalone
// Resolve/Unresolve action and the Reply & resolve combo's second leg.
// Result copy also goes through the page live region, so it outlives the
// request even if this detail collapsed while it was in flight. No optimistic
// update: every settled outcome refetches and the row re-renders from server
// truth.
import { useCallback, useRef, useState } from "react";

import { useReviewActions } from "@web/features/review/session";
import {
  ResolveThreadResultKinds,
  type ResolveThreadResult,
  type ResolveThreadResultKind,
} from "../../../types";
import type { ThreadResolutionWiring } from "../../../wiring";

export const RESOLVE_KEYS = {
  RESOLVED: "conversation.resolve.resolved",
  UNRESOLVED: "conversation.resolve.unresolved",
  UNAUTHORIZED: "conversation.resolve.unauthorized",
  NOT_FOUND: "conversation.resolve.notFound",
  // The route only returns 403 at the MUTATION stage, after the viewer proved
  // repo access, so this is a real capability gap (raced revocation,
  // read-only collaborator), not an existence miss.
  GITHUB_PERMISSION: "conversation.resolve.githubPermission",
  INVALID: "conversation.resolve.invalid",
  NO_WRITE_ACCESS: "pulls.briefError.no-repo-write-access",
  UPSTREAM: "conversation.resolve.upstream",
  // INDETERMINATE: a throw can land after the POST reached GitHub. Both
  // directions are idempotent, so retrying is safe, but the copy must not
  // claim the thread is unchanged.
  FAILED: "conversation.resolve.failed",
} as const satisfies Record<string, TranslationKey>;

const FAILURE_KEYS: Record<
  Exclude<
    ResolveThreadResultKind,
    | typeof ResolveThreadResultKinds.DONE
    | typeof ResolveThreadResultKinds.INDETERMINATE
  >,
  TranslationKey
> = {
  [ResolveThreadResultKinds.UNAUTHORIZED]: RESOLVE_KEYS.UNAUTHORIZED,
  [ResolveThreadResultKinds.GITHUB_PERMISSION]: RESOLVE_KEYS.GITHUB_PERMISSION,
  [ResolveThreadResultKinds.NOT_FOUND]: RESOLVE_KEYS.NOT_FOUND,
  [ResolveThreadResultKinds.INVALID]: RESOLVE_KEYS.INVALID,
  [ResolveThreadResultKinds.NO_WRITE_ACCESS]: RESOLVE_KEYS.NO_WRITE_ACCESS,
  [ResolveThreadResultKinds.UPSTREAM]: RESOLVE_KEYS.UPSTREAM,
};

/**
 * One flip attempt's outcome. `indeterminate` is NOT a flavour of failure: the
 * request threw AROUND the write, so GitHub may well have applied it. The
 * standalone path already says so in its copy, and the combo needs the same
 * distinction to avoid asserting a failure that did not happen.
 */
export type ResolveAttempt = "resolved" | "failed" | "indeterminate";

export interface UseThreadResolutionInput {
  threadId: number;
  /** The thread's CURRENT server state; sets the standalone action's direction. */
  isResolved: boolean;
  /** The route's transport + capability; `undefined` = local path. */
  resolution: ThreadResolutionWiring | undefined;
}

export interface UseThreadResolutionValue {
  /** Whether any resolution affordance may render at all. */
  available: boolean;
  /** True while EITHER entry point is in flight (both share the guard). */
  pending: boolean;
  /** Standalone failure copy; also announced (it must outlive the request). */
  error: string | null;
  /** Flip to the direction opposite the thread's current state. */
  toggle: () => void;
  /**
   * The combo's second leg. Reports the attempt's outcome, including
   * `indeterminate`, which the composer must render as such (a thrown resolve
   * after a landed reply may still have resolved the thread). Deliberately
   * silent: it sets no error and announces nothing, so the composer can own the
   * single compound message instead of the reviewer reading two half-truths.
   */
  resolveAfterReply: () => Promise<ResolveAttempt>;
}

export function useThreadResolution(
  input: UseThreadResolutionInput,
): UseThreadResolutionValue {
  const { t } = useTranslation();
  const { threadId, isResolved, resolution } = input;
  const { announce } = useReviewActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous double-click guard: state updates are async and aria-disabled
  // does not block the click event.
  const inFlight = useRef(false);

  const run = useCallback(
    async (target: boolean, surfaceCopy: boolean): Promise<ResolveAttempt> => {
      // A flip already in flight: nothing was attempted here, and the one that
      // IS running owns the outcome. Reported as a plain failure, never as
      // indeterminate (this call reached no write at all).
      if (resolution === undefined || inFlight.current) {
        return "failed";
      }
      inFlight.current = true;
      setPending(true);
      // Cleared on both paths: a stale standalone error next to a fresh
      // combo run would misreport the current state of the thread.
      setError(null);
      const fail = (copy: string) => {
        if (!surfaceCopy) {
          return;
        }
        setError(copy);
        announce(copy);
      };
      // The write may have landed: refetch so the row shows where it
      // actually ended up, and say so in the (indeterminate) copy.
      const settleIndeterminate = (): ResolveAttempt => {
        resolution.refetchConversation();
        fail(t(RESOLVE_KEYS.FAILED));
        return "indeterminate";
      };
      try {
        let result: ResolveThreadResult;
        try {
          result = await resolution.setResolved(threadId, target);
        } catch (thrown) {
          console.error("thread resolution failed", thrown);
          return settleIndeterminate();
        }
        if (result.kind === ResolveThreadResultKinds.INDETERMINATE) {
          return settleIndeterminate();
        }
        if (result.kind === ResolveThreadResultKinds.DONE) {
          // Convergence is success and takes the SAME path: the local view was
          // out of date either way, so the refetch is the correction.
          resolution.refetchConversation();
          if (surfaceCopy) {
            announce(
              target ? t(RESOLVE_KEYS.RESOLVED) : t(RESOLVE_KEYS.UNRESOLVED),
            );
          }
          return "resolved";
        }
        if (result.kind === ResolveThreadResultKinds.GITHUB_PERMISSION) {
          // Both truths are suspect: the thread may have moved under us AND
          // the capability that offered this button may be gone.
          resolution.refetchConversation();
          resolution.refetchCapability();
        }
        fail(t(FAILURE_KEYS[result.kind]));
        // A route-level rejection is determinate: the server answered, and it
        // did not apply the flip.
        return "failed";
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [announce, resolution, threadId, t],
  );

  // Direction captured HERE, at initiation: a conversation refetch settling
  // mid-flight flips `isResolved`, and a direction read later would send the
  // opposite of what the reviewer clicked.
  const toggle = useCallback(() => {
    void run(!isResolved, true);
  }, [isResolved, run]);
  const resolveAfterReply = useCallback(() => run(true, false), [run]);

  return {
    available: resolution !== undefined && resolution.canResolve,
    pending,
    error,
    toggle,
    resolveAfterReply,
  };
}
