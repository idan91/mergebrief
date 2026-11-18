import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useAnnouncer } from "@web/hooks/useAnnouncer";
import type { DiffQueryState, DiffRetryLanding } from "./types";
import { isFocusLost, isRetryFailed, readDiffFetchRetry } from "./utils";

/**
 * The surface's side of a timeout retry. When the notice left holding focus
 * and the read then settles, on the body or on an error it offers no retry
 * for, focus moves to `findTarget`'s element and the status line says which.
 * A retry that times out again keeps the notice, so focus stays on its button.
 */
export function useDiffRetryLanding(
  query: DiffQueryState,
  findTarget: () => HTMLElement | null,
): DiffRetryLanding {
  const { t } = useTranslation();
  const { text, announce } = useAnnouncer();
  const focusReleased = useRef(false);
  const findTargetRef = useRef(findTarget);
  const landed = query.data !== undefined;

  useEffect(() => {
    findTargetRef.current = findTarget;
  });

  const retry = readDiffFetchRetry(query, () => {
    focusReleased.current = true;
  });
  const failed = isRetryFailed(query, retry);

  useEffect(() => {
    const settled = landed || failed;
    if (!settled || !focusReleased.current) {
      return;
    }
    focusReleased.current = false;
    if (isFocusLost()) {
      findTargetRef.current()?.focus({ preventScroll: true });
    }
    announce(
      t(landed ? "brief.diff.timeoutLanded" : "brief.diff.timeoutFailed"),
    );
  }, [announce, failed, landed, t]);

  return { retry, announcement: text };
}
