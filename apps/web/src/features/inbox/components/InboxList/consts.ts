/**
 * Marks the one link in an inbox row that opens its brief; a row holds other
 * links beside it. Runtime reads it through `ROW_LINK_SELECTOR` to hand that
 * link the cursor's focus; it is neither a test nor a styling hook.
 */
export const ROW_LINK_ATTRIBUTE = "data-row-link";

/** Matches a row's link to its brief. */
export const ROW_LINK_SELECTOR = `[${ROW_LINK_ATTRIBUTE}]`;

/** The rows of both lists, in the order the cursor counts them. */
export const ROW_SELECTOR = ":scope > ol > li";
