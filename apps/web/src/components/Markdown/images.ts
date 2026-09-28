import {
  AttachmentSourceKinds,
  parseAttachmentSource,
  type AttachmentSource,
} from "contract";
import type { Element } from "hast";
import { visit } from "unist-util-visit";

import type { AttachmentScope } from "./context";
import type { RehypeTransform } from "./types";

const HTTPS_PREFIX = "https://";

/** An image's absolute https source; a relative one would carry this origin's cookie. */
function readImageSource(node: Element): string | undefined {
  if (node.tagName !== "img") {
    return undefined;
  }
  const source = node.properties["src"];
  if (typeof source !== "string" || !source.startsWith(HTTPS_PREFIX)) {
    return undefined;
  }
  return source;
}

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
      if (readImageSource(node) !== undefined) {
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

/** The proxy names a GitHub asset by its id and a branch file by its file name. */
export function buildAttachmentProxyPath(
  scope: AttachmentScope,
  target: string,
): string {
  return `/api/repos/${scope.repoId}/pulls/${scope.prNumber}/attachments/${target}`;
}

function readProxyTarget(source: AttachmentSource): string {
  if (source.kind === AttachmentSourceKinds.BRANCH) {
    return source.fileName;
  }
  return source.assetId;
}

/**
 * A private attachment answers 404 to a cross-origin <img>, so its source is
 * pointed at the API's same-origin proxy, where the session cookie rides.
 */
export function rehypeProxyAttachmentSources(
  scope: AttachmentScope | undefined,
): RehypeTransform {
  return (tree) => {
    if (scope === undefined) {
      return;
    }
    visit(tree, "element", (node) => {
      const source = readImageSource(node);
      if (source === undefined) {
        return;
      }
      const attachment = parseAttachmentSource(source);
      if (!attachment.ok) {
        return;
      }

      node.properties["src"] = buildAttachmentProxyPath(
        scope,
        readProxyTarget(attachment.value),
      );
    });
  };
}
