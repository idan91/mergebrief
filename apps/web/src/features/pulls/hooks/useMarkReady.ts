// The mark-ready facade hook: owns pending state and the result-kind toast
// copy. The action is injected by the DB route; absent action = not an
// own-draft view, so `markReady` no-ops.
//
// On success the hook announces and stops; it never clears the own-draft UI
// locally. The injected action awaits the pr-view invalidation, so the
// affordances vanish exactly when the refreshed PrView lands in the cache.
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { MarkReadyAction } from "../transport/markReady";
import { MarkReadyResultKinds } from "../transport/types";

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

export function useMarkReady(input: UseMarkReadyInput): UseMarkReadyValue {
  const { action, announce } = input;
  const { t } = useTranslation();
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
          case MarkReadyResultKinds.READY: {
            announce(t("pulls.markReady.ready"));
            break;
          }
          case MarkReadyResultKinds.UNAUTHORIZED: {
            announce(t("pulls.markReady.unauthorized"));
            break;
          }
          case MarkReadyResultKinds.NOT_FOUND: {
            announce(t("pulls.markReady.notFound"));
            break;
          }
          case MarkReadyResultKinds.NO_WRITE_ACCESS: {
            announce(t("pulls.briefError.no-repo-write-access"));
            break;
          }
          case MarkReadyResultKinds.GITHUB_PERMISSION: {
            announce(t("pulls.markReady.githubPermission"));
            break;
          }
          case MarkReadyResultKinds.UPSTREAM: {
            announce(t("pulls.markReady.upstream"));
            break;
          }
        }
      } catch (error) {
        console.error("mark-ready failed", error);
        announce(t("pulls.markReady.failed"));
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    })();
  }, [action, announce, t]);

  return { pending, markReady };
}
