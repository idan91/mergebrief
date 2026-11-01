/**
 * The hast property the rehype chain writes on an image: the address the
 * author wrote, before the proxy step rewrites `src`. `InlineImage` reads it
 * off its node to link a failed row; it never reaches the DOM.
 */
export const ORIGINAL_SOURCE_PROPERTY = "dataOriginalSource";
/** The prop name react-markdown hands `ORIGINAL_SOURCE_PROPERTY` to a renderer under. */
export const ORIGINAL_SOURCE_ATTRIBUTE = "data-original-source";
