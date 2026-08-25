import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";
// Thread-resolution facade: ThreadDetail wires the transport in, this hook
// owns pending/error/copy for both entry points — the standalone
// Resolve/Unresolve action and the Reply & resolve combo's second leg.
//
// Async-mutation rules as they apply here:
// - the DIRECTION is captured at initiation, so a refetch landing mid-flight
//   (which flips `isResolved`) can never redirect the request in progress;
// - the GitHub write is the commit point — a throw AROUND it gets INDETERMINATE
//   copy, never "nothing happened";
// - result copy also goes through the page live region, so it outlives the
//   request even if this detail collapsed while it was in flight;
// - no optimistic update: every settled outcome refetches and the row
//   re-renders from server truth.
import { useCallback, useRef, useState } from "react";

import { useReviewActions } from "@web/features/review/session";
import type { ResolveThreadResult } from "../../../resolve";
import type { ThreadResolutionWiring } from "../../../wiring";

export const RESOLVE_KEYS = {
  resolved: "conversation.resolve.resolved",
  unresolved: "conversation.resolve.unresolved",
  unauthorized: "conversation.resolve.unauthorized",
  notFound: "conversation.resolve.notFound",
  // The route only returns 403 at the MUTATION stage, after the viewer proved
  // repo access — so this is a real capability gap (raced revocation,
  // read-only collaborator), not an existence miss.
  githubPermission: "conversation.resolve.githubPermission",
  invalid: "conversation.resolve.invalid",
  "no-write-access": "pulls.briefError.no-repo-write-access",
  upstream: "conversation.resolve.upstream",
  // INDETERMINATE: a throw can land after the POST reached GitHub. Both
  // directions are idempotent, so retrying is safe — but the copy must not
  // claim the thread is unchanged.
  failed: "conversation.resolve.failed",
} as const satisfies Record<string, TranslationKey>;

const FAILURE_KEYS: Record<
  Exclude<ResolveThreadResult["kind"], "done">,
  TranslationKey
> = {
  unauthorized: RESOLVE_KEYS.unauthorized,
  "github-permission": RESOLVE_KEYS.githubPermission,
  "not-found": RESOLVE_KEYS.notFound,
  invalid: RESOLVE_KEYS.invalid,
  "no-write-access": RESOLVE_KEYS["no-write-access"],
  upstream: RESOLVE_KEYS.upstream,
};

/**
 * One flip attempt's outcome. `indeterminate` is NOT a flavour of failure: the
 * request threw AROUND the write, so GitHub may well have applied it — the
 * standalone path already says so in its copy, and the combo needs the same
 * distinction to avoid asserting a failure that did not happen.
 */
export type ResolveAttempt = "resolved" | "failed" | "indeterminate";

export interface UseThreadResolutionInput {
  threadId: number;
  /** The thread's CURRENT server state — the standalone action's direction. */
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
   * The combo's second leg. Reports the attempt's outcome — including
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
      // IS running owns the outcome — reported as a plain failure, never as
      // indeterminate (this call reached no write at all).
      if (resolution === undefined || inFlight.current) return "failed";
      inFlight.current = true;
      setPending(true);
      // Cleared on both paths: a stale standalone error next to a fresh
      // combo run would misreport the current state of the thread.
      setError(null);
      const fail = (copy: string) => {
        if (!surfaceCopy) return;
        setError(copy);
        announce(copy);
      };
      try {
        let result: ResolveThreadResult;
        try {
          result = await resolution.setResolved(threadId, target);
        } catch (thrown) {
          console.error("thread resolution failed", thrown);
          // The write may have landed — refetch so the row shows where it
          // actually ended up, and say so in the (indeterminate) copy.
          resolution.refetchConversation();
          fail(t(RESOLVE_KEYS.failed));
          return "indeterminate";
        }
        if (result.kind === "done") {
          // Convergence is success and takes the SAME path: the local view was
          // out of date either way, so the refetch is the correction.
          resolution.refetchConversation();
          if (surfaceCopy) {
            announce(
              target ? t(RESOLVE_KEYS.resolved) : t(RESOLVE_KEYS.unresolved),
            );
          }
          return "resolved";
        }
        if (result.kind === "github-permission") {
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
