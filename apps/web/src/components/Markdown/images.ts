import {
  buildCommittedFileUrl,
  isCommittedFileInRepository,
  isServableCommittedFile,
  parseCommittedFileUrl,
} from "brief-core/media-address";
import {
  AttachmentSourceKinds,
  buildOperationPath,
  parseAttachmentSource,
  ProductQueryIds,
  type AttachmentSource,
} from "contract";
import type { Element } from "hast";
import { SKIP, visit } from "unist-util-visit";

import type { AttachmentScope } from "./context";
import { ORIGINAL_SOURCE_PROPERTY } from "./InlineImage/consts";
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

/**
 * Runs after sanitize, which strips any such property the author wrote, and
 * before the proxy step rewrites `src`, so a failed row links the address the
 * author wrote. An image inside a link records none: its failed row must not
 * nest a second link.
 */
export function rehypeRecordOriginalSources(): RehypeTransform {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName === "a") {
        return SKIP;
      }
      const source = readImageSource(node);
      if (source !== undefined) {
        node.properties[ORIGINAL_SOURCE_PROPERTY] = source;
      }
      return undefined;
    });
  };
}

/** The proxy names a GitHub asset by its id and a branch file by its file name. */
export function buildAttachmentProxyPath(
  scope: AttachmentScope,
  target: string,
): string {
  return buildOperationPath(ProductQueryIds.READ_ATTACHMENT, {
    repoId: scope.repoId,
    prNumber: scope.prNumber,
    assetId: target,
  });
}

function readProxyTarget(source: AttachmentSource): string {
  if (source.kind === AttachmentSourceKinds.BRANCH) {
    return source.fileName;
  }
  return source.assetId;
}

/** A committed image of the pull request's own repository in a format the proxy serves, named by its normalised address. */
function buildCommittedFileProxyPath(
  scope: AttachmentScope,
  source: string,
): string | undefined {
  if (scope.repoSlug === undefined) {
    return undefined;
  }
  const committed = parseCommittedFileUrl(source);
  if (!committed.ok || !isServableCommittedFile(committed.value)) {
    return undefined;
  }
  if (!isCommittedFileInRepository(committed.value, scope.repoSlug)) {
    return undefined;
  }

  const path = buildOperationPath(ProductQueryIds.READ_COMMITTED_FILE, {
    repoId: scope.repoId,
    prNumber: scope.prNumber,
  });
  const query = new URLSearchParams({
    source: buildCommittedFileUrl(committed.value),
  });
  return `${path}?${query.toString()}`;
}

function buildProxyPath(
  scope: AttachmentScope,
  source: string,
): string | undefined {
  const attachment = parseAttachmentSource(source);
  if (attachment.ok) {
    return buildAttachmentProxyPath(scope, readProxyTarget(attachment.value));
  }
  return buildCommittedFileProxyPath(scope, source);
}

/**
 * A private attachment, or a file committed to the pull request's private
 * repository, answers 404 to a cross-origin <img>, so its source is pointed
 * at the API's same-origin proxy, where the session cookie rides. A file in
 * another repository stays on GitHub.
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
      const proxyPath = buildProxyPath(scope, source);
      if (proxyPath !== undefined) {
        node.properties["src"] = proxyPath;
      }
    });
  };
}
