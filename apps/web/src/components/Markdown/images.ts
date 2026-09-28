import { visit } from "unist-util-visit";

import type { RehypeTransform } from "./types";

const HTTPS_PREFIX = "https://";

/**
 * Runs after sanitize, which drops a disallowed scheme but keeps a source
 * with none: a scheme-relative or path-relative one would resolve against
 * this origin and carry the session cookie, so only an absolute https
 * source stays. An image left with no source is a broken glyph and goes
 * with it. One with no `alt` gets an empty one, so a reader hears nothing
 * rather than the URL.
 */
export function rehypeNormalizeImages(): RehypeTransform {
  return (tree) => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "img") {
        return undefined;
      }
      const source = node.properties["src"];
      if (typeof source === "string" && source.startsWith(HTTPS_PREFIX)) {
        node.properties["alt"] ??= "";
        return undefined;
      }
      if (parent === undefined || index === undefined) {
        return undefined;
      }

      parent.children.splice(index, 1);
      return index;
    });
  };
}
