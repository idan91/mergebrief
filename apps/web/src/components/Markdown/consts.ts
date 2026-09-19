/**
 * A "#" in a comment renders as an h3 and a "##" as an h4, so a comment can
 * never add a second h1 to a screen that already has one.
 */
export const DEMOTED_HEADING_COMPONENTS = { h1: "h3", h2: "h4" } as const;
