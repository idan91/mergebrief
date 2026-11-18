import type { ValueOf } from "types";

/**
 * A brief read carrying this header asks the api to start the span's diff
 * read too. The server render sends it: the browser cannot ask for the diff
 * until it hydrates.
 */
export const WARM_SPAN_DIFF_HEADER = "mergebrief-warm-span-diff";

/** The diff read's answer names which read it served, as the body is plain text. */
export const DIFF_MODE_HEADER = "mergebrief-diff-mode";

/** What a `base...head` diff read served: the revision span its marks came from, or GitHub's compare. */
export const DiffModes = {
  REVISION_SPAN: "revision-span",
  COMPARE: "compare",
} as const;
export type DiffMode = ValueOf<typeof DiffModes>;
