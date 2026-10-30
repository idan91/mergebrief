/** A pointer resting on a control this long earns its callout; focus shows it at once. */
export const CALLOUT_HOVER_DELAY_MS = 350;

/**
 * Matches a callout's floating root. A consumer queries it to tell focus or
 * a scroll inside the callout, its own scroller included, from one outside.
 */
export const CALLOUT_ROOT_SELECTOR = "[data-callout]";

/**
 * floating-ui's portal parks each tabbable at `tabindex="-1"` while focus is
 * outside it and keeps the element's own value here, restored on re-entry.
 */
export const PARKED_TABINDEX_ATTRIBUTE = "data-tabindex";

/** Matches floating-ui's portal node, the container it parks and restores. */
export const FLOATING_PORTAL_SELECTOR = "[data-floating-ui-portal]";
