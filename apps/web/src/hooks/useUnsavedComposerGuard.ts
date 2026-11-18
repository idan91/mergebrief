import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "@tanstack/react-router";

// Written only in effects, so the module singleton is safe under SSR.
const unsavedComposers = new Set<string>();

export function hasUnsavedComposerText(): boolean {
  return unsavedComposers.size > 0;
}

/**
 * Only text a navigation would destroy registers: reply drafts persist as
 * they are typed and must not.
 */
export function useUnsavedComposerText(id: string, unsaved: boolean): void {
  useEffect(() => {
    if (unsaved) {
      unsavedComposers.add(id);
    } else {
      unsavedComposers.delete(id);
    }
    return () => {
      unsavedComposers.delete(id);
    };
  }, [id, unsaved]);
}

/**
 * Blocks in-app navigation behind a confirm while any composer holds
 * never-saved text, and arms beforeunload for hard navigations.
 */
export function useUnsavedComposerBlocker(): void {
  const { t } = useTranslation();
  useBlocker({
    shouldBlockFn: ({ current, next }) => {
      // A same-path search change (view toggles, revision pins, URL
      // normalization) is not leaving the page and must not prompt.
      if (current.pathname === next.pathname) {
        return false;
      }
      if (unsavedComposers.size === 0) {
        return false;
      }
      return !window.confirm(t("shell.unsavedCommentLeavePrompt"));
    },
    enableBeforeUnload: () => unsavedComposers.size > 0,
  });
}
