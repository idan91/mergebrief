// The mark-ready facade hook (BRIEF-43 PR 3): the heavy Brief screen wires
// props in, this hook owns pending state and the result-kind toast copy —
// `useReviewSubmit` is the template. The action is injected by the DB route;
// absent action = not an own-draft view (local path included), the flow is
// unavailable and `markReady` no-ops.
//
// No state flicker by construction: on success the hook announces and stops —
// it never clears the own-draft UI locally. The injected action awaits the
// pr-view invalidation, so the affordances vanish exactly when the refreshed
// PrView (draft=false) lands in the query cache.
import { useCallback, useRef, useState } from "react";

import type { MarkReadyAction } from "../transport/markReady";

export interface UseMarkReadyInput {
  /** The DB route's transport (+ pr-view invalidation); `undefined` = unavailable. */
  action: MarkReadyAction | undefined;
  /** Page-level live-region channel (the toast) for success and failure copy. */
  announce: (message: string) => void;
}

export interface UseMarkReadyValue {
  pending: boolean;
  markReady: () => void;
}

export const MARK_READY_COPY = {
  ready: "Marked ready for review.",
  unauthorized:
    "Your GitHub session expired — sign in again to mark this pull request ready.",
  notFound: "This pull request is no longer accessible on GitHub.",
  githubPermission:
    "GitHub blocked the action: the MergeBrief App needs the 'Contents: Read & write' repository permission to mark a PR ready. Update the App's permissions and retry.",
  upstream:
    "GitHub rejected the request or is unreachable — try again shortly.",
  // Marking ready is idempotent on GitHub's side (already-ready converges),
  // so unlike the submit flow this copy can safely invite a retry.
  failed: "Something went wrong marking this pull request ready — try again.",
} as const;

export function useMarkReady(input: UseMarkReadyInput): UseMarkReadyValue {
  const { action, announce } = input;
  const [pending, setPending] = useState(false);
  // Synchronous double-click guard: state updates are async, a ref is not.
  const inFlight = useRef(false);

  const markReady = useCallback(() => {
    if (action === undefined || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    void (async () => {
      try {
        const result = await action();
        switch (result.kind) {
          case "ready": {
            announce(MARK_READY_COPY.ready);
            break;
          }
          case "unauthorized": {
            announce(MARK_READY_COPY.unauthorized);
            break;
          }
          case "not-found": {
            announce(MARK_READY_COPY.notFound);
            break;
          }
          case "github-permission": {
            announce(MARK_READY_COPY.githubPermission);
            break;
          }
          case "upstream": {
            announce(MARK_READY_COPY.upstream);
            break;
          }
        }
      } catch (error) {
        console.error("mark-ready failed", error);
        announce(MARK_READY_COPY.failed);
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    })();
  }, [action, announce]);

  return { pending, markReady };
}
