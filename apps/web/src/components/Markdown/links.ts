import { visit } from "unist-util-visit";

import { MARKDOWN_SANITIZE_SCHEMA } from "./consts";
import type { RehypeTransform } from "./types";

const FRAGMENT = "#";
const CLOBBER_PREFIX = MARKDOWN_SANITIZE_SCHEMA.clobberPrefix ?? "";

/**
 * Sanitize prefixes every `id` against DOM clobbering but leaves `href`
 * alone, so a same-document link would point at an id that no longer
 * exists. Prefixing the link the same way keeps footnotes jumping.
 */
export function rehypePrefixFragmentLinks(): RehypeTransform {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "a") {
        return;
      }
      const href = node.properties["href"];
      if (typeof href !== "string" || !href.startsWith(FRAGMENT)) {
        return;
      }

      node.properties["href"] =
        `${FRAGMENT}${CLOBBER_PREFIX}${href.slice(FRAGMENT.length)}`;
    });
  };
}
