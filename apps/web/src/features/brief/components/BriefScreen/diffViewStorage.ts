import { z } from "zod/v4";

import { DiffViews, type DiffView } from "@web/components/DiffRows/types";

export const DIFF_VIEW_STORAGE_KEY = "mergebrief.diffView";

// A view this build no longer ships must not strand the reader on a blank
// preference; the catch lands them back on the default.
const diffViewSchema = z.enum(DiffViews).catch(DiffViews.UNIFIED);

export function readDiffView(): DiffView {
  if (typeof window === "undefined") return DiffViews.UNIFIED;

  try {
    const raw = window.localStorage.getItem(DIFF_VIEW_STORAGE_KEY);
    if (raw === null) return DiffViews.UNIFIED;

    return diffViewSchema.parse(JSON.parse(raw));
  } catch {
    return DiffViews.UNIFIED;
  }
}

export function writeDiffView(view: DiffView): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Storage denied (private mode, quota): the choice still holds for this page.
  }
}

/** A deep link names the view outright; otherwise the viewer's own preference. */
export function resolveDiffView(
  search: DiffView | undefined,
  stored: DiffView,
): DiffView {
  return search ?? stored;
}
