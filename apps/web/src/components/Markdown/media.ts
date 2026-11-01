import {
  isProxiedMediaAddress,
  ProxiedMediaSourceKinds,
  readProxiedMediaSource,
} from "brief-core/media";
import {
  buildCommittedFileUrl,
  type CommittedFileSource,
} from "brief-core/media-address";
import {
  AttachmentSourceKinds,
  buildOperationPath,
  ProductQueryIds,
  type AttachmentSource,
} from "contract";
import type { Element, ElementContent, Root } from "hast";
import { SKIP, visit } from "unist-util-visit";

import type { AttachmentScope } from "./context";
import { ORIGINAL_SOURCE_PROPERTY } from "./original-source";
import type { RehypeTransform } from "./types";

const HTTPS_PREFIX = "https://";
const MEDIA_TAG_NAMES: ReadonlySet<string> = new Set(["img", "video"]);

/** An image's or video's absolute https source; a relative one would carry this origin's cookie. */
function readMediaSource(node: Element): string | undefined {
  if (!MEDIA_TAG_NAMES.has(node.tagName)) {
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
 * source stays. An image or video left with no source is a broken glyph
 * and goes with it. An image with no `alt` gets an empty one, so a reader
 * hears nothing rather than the URL.
 */
export function rehypeNormalizeMedia(): RehypeTransform {
  return (tree) => {
    visit(tree, "element", (node, index, parent) => {
      if (!MEDIA_TAG_NAMES.has(node.tagName)) {
        return undefined;
      }
      if (readMediaSource(node) !== undefined) {
        if (node.tagName === "img") {
          node.properties["alt"] ??= "";
        }
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
      const source = readMediaSource(node);
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

/** A served file of the pull request's own repository, named by its normalised address. */
function buildCommittedFileProxyPath(
  scope: AttachmentScope,
  file: CommittedFileSource,
): string {
  const path = buildOperationPath(ProductQueryIds.READ_COMMITTED_FILE, {
    repoId: scope.repoId,
    prNumber: scope.prNumber,
  });
  const query = new URLSearchParams({ source: buildCommittedFileUrl(file) });
  return `${path}?${query.toString()}`;
}

function buildProxyPath(
  scope: AttachmentScope,
  source: string,
): string | undefined {
  const proxied = readProxiedMediaSource(source, scope.repoSlug);
  if (proxied === undefined) {
    return undefined;
  }
  if (proxied.kind === ProxiedMediaSourceKinds.ATTACHMENT) {
    const target = readProxyTarget(proxied.attachment);
    return buildAttachmentProxyPath(scope, target);
  }
  return buildCommittedFileProxyPath(scope, proxied.file);
}

/**
 * A private attachment, or a file committed to the pull request's private
 * repository, answers 404 to a cross-origin <img> or <video>, so its source is pointed
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
      const source = readMediaSource(node);
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

function buildAddressLink(address: string): Element {
  return {
    type: "element",
    tagName: "a",
    properties: { href: address },
    children: [{ type: "text", value: address }],
  };
}

function replaceUnservedVideo(
  node: Element,
  scope: AttachmentScope | undefined,
  insideLink: boolean,
): ElementContent | undefined {
  const source = readMediaSource(node);
  if (node.tagName !== "video" || source === undefined) {
    return undefined;
  }
  if (insideLink) {
    return { type: "text", value: source };
  }
  const served =
    scope !== undefined && isProxiedMediaAddress(source, scope.repoSlug);
  return served ? undefined : buildAddressLink(source);
}

function linkUnservedVideos(
  parent: Element | Root,
  scope: AttachmentScope | undefined,
  insideLink: boolean,
): void {
  parent.children.forEach((child, index) => {
    if (child.type !== "element") {
      return;
    }
    const replacement = replaceUnservedVideo(child, scope, insideLink);
    if (replacement !== undefined) {
      parent.children[index] = replacement;
      return;
    }
    linkUnservedVideos(child, scope, insideLink || child.tagName === "a");
  });
}

/**
 * Runs before the proxy step. A player plays only what the proxy serves: a
 * pasted asset or a file in the pull request's own repository. Any other
 * video stays a link to its address, as on a page with no pull request, and
 * a video inside a link stays its address as text, since a player there
 * would nest controls in the link.
 */
export function rehypeLinkUnservedVideos(
  scope: AttachmentScope | undefined,
): RehypeTransform {
  return (tree) => {
    linkUnservedVideos(tree, scope, false);
  };
}
