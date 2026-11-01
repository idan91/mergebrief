import { ORIGINAL_SOURCE_ATTRIBUTE } from "./consts";

/** The renderer's props without the recorded original address, so every attribute sanitize kept reaches the DOM and that one does not. */
export function dropOriginalSource<Attributes extends object>(
  attributes: Attributes,
): Attributes {
  const domAttributes = { ...attributes };
  Reflect.deleteProperty(domAttributes, ORIGINAL_SOURCE_ATTRIBUTE);
  return domAttributes;
}
