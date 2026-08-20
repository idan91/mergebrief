import { useEffect } from "react";
import { useBlocker } from "@tanstack/react-router";

// Module-level registry: composers register while they hold never-saved
// text; the screen-level blocker reads the count. Client-only by
// construction (writes happen in effects), so the module singleton is safe
// under SSR.
const unsavedComposers = new Set<string>();

/** True only in tests/diagnostics — the blocker consumes this internally. */
export function hasUnsavedComposerText(): boolean {
  return unsavedComposers.size > 0;
}

/**
 * Marks this composer as holding never-saved text. "Never-saved" is the
 * operative word: reply drafts persist themselves as they are typed and must
 * NOT register — only text a navigation would actually destroy belongs here.
 */
export function useUnsavedComposerText(id: string, unsaved: boolean): void {
  useEffect(() => {
    if (unsaved) unsavedComposers.add(id);
    else unsavedComposers.delete(id);
    return () => {
      unsavedComposers.delete(id);
    };
  }, [id, unsaved]);
}

const LEAVE_PROMPT =
  "You have an unsaved comment. Leave this page and discard it?";

/**
 * Screen-level guard: blocks in-app navigation behind a confirm while any
 * composer holds never-saved text, and arms the browser's beforeunload
 * prompt for hard navigations.
 */
export function useUnsavedComposerBlocker(): void {
  useBlocker({
    shouldBlockFn: ({ current, next }) => {
      // Same-route search changes (View/Compare toggles, revision pins, the
      // route's own URL-normalization replace) are not "leaving the page" —
      // prompting there would fire the confirm on non-user navigations and
      // lie in its copy. Only a pathname change risks the composer text.
      if (current.pathname === next.pathname) return false;
      if (unsavedComposers.size === 0) return false;
      return !window.confirm(LEAVE_PROMPT);
    },
    enableBeforeUnload: () => unsavedComposers.size > 0,
  });
}
