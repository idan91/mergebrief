import type { Element } from "hast";

/**
 * The hast property the rehype chain writes on an image or video: the
 * address the author wrote, before the proxy step rewrites `src`. The media
 * components read it off their node to link a failed row; it never reaches
 * the DOM.
 */
export const ORIGINAL_SOURCE_PROPERTY = "dataOriginalSource";
/** The prop name react-markdown hands `ORIGINAL_SOURCE_PROPERTY` to a renderer under. */
const ORIGINAL_SOURCE_ATTRIBUTE = "data-original-source";

/** The address the author wrote for a media node, as the rehype chain recorded it. */
export function readOriginalSource(
  node: Element | undefined,
): string | undefined {
  const recorded = node?.properties[ORIGINAL_SOURCE_PROPERTY];
  return typeof recorded === "string" ? recorded : undefined;
}

/** A renderer's props without the recorded original address, so every attribute sanitize kept reaches the DOM and that one does not. */
export function dropOriginalSource<Attributes extends object>(
  attributes: Attributes,
): Attributes {
  const domAttributes = { ...attributes };
  Reflect.deleteProperty(domAttributes, ORIGINAL_SOURCE_ATTRIBUTE);
  return domAttributes;
}
