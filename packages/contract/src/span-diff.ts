/**
 * A brief read carrying this header asks the api to start the span's diff
 * read too. The server render sends it: the browser cannot ask for the diff
 * until it hydrates.
 */
export const WARM_SPAN_DIFF_HEADER = "mergebrief-warm-span-diff";
