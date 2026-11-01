import { readMermaidFenceCode } from "brief-core/media";
import type { Element } from "hast";
import { SKIP, visit } from "unist-util-visit";

import type { RehypeTransform } from "./types";

/**
 * The hast property the fence step writes on a `pre` that holds a Mermaid
 * fence: the fence's code, so the renderer's `pre` draws a diagram. Read off
 * the node; never forwarded to the DOM.
 */
export const MERMAID_FENCE_PROPERTY = "dataMermaidFence";

/** Runs after sanitize, which strips any such property the author wrote: only text people wrote draws a diagram. */
export function rehypeMarkMermaidFences(): RehypeTransform {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "pre") {
        return undefined;
      }
      const code = readMermaidFenceCode(node);
      if (code !== undefined) {
        node.properties[MERMAID_FENCE_PROPERTY] = code;
      }
      return SKIP;
    });
  };
}

/** The Mermaid code the fence step recorded on a `pre`; none on any other node. */
export function readMarkedFenceCode(
  node: Element | undefined,
): string | undefined {
  const marked = node?.properties[MERMAID_FENCE_PROPERTY];
  return typeof marked === "string" ? marked : undefined;
}
