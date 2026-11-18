import {
  isProxiedMediaAddress,
  ProxiedMediaSourceKinds,
  readProxiedMediaSource,
} from "brief-core/media";
import {
  buildCommittedFileUrl,
  GITHUB_HOST,
  RAW_CONTENT_HOST,
  type CommittedFileSource,
} from "brief-core/media-address";
import {
  ATTACHMENT_THUMBNAIL_PARAM,
  AttachmentSourceKinds,
  AttachmentThumbnails,
  buildOperationPath,
  ProductQueryIds,
  type AttachmentSource,
} from "contract";
import type { Element, ElementContent, Root } from "hast";
import type { HTMLAttributeReferrerPolicy } from "react";
import { SKIP, visit } from "unist-util-visit";

import type { AttachmentScope } from "./context";
import { ORIGINAL_SOURCE_PROPERTY } from "./original-source";
import type { RehypeTransform } from "./types";

const HTTPS_PREFIX = "https://";
const SVG_EXTENSION = ".svg";
const NO_REFERRER: HTMLAttributeReferrerPolicy = "no-referrer";
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

/**
 * An image the browser fetches from another host itself sends no referrer,
 * so that host never learns which instance shows it. Only the proxy's
 * same-origin path keeps the default.
 */
export function readImageReferrerPolicy(
  source: string | undefined,
): HTMLAttributeReferrerPolicy | undefined {
  const fetchedFromOtherHost = source?.startsWith(HTTPS_PREFIX) === true;
  return fetchedFromOtherHost ? NO_REFERRER : undefined;
}

/**
 * The hosts GitHub serves its own stored files from, named one by one. Two
 * of its hosts are left out on purpose: `camo.githubusercontent.com` relays
 * an image from any host and can fetch it again on each view, and
 * `github.io` pages are any user's own.
 */
const GITHUB_CONTENT_HOSTS: ReadonlySet<string> = new Set([
  GITHUB_HOST,
  RAW_CONTENT_HOST,
  "user-images.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "avatars.githubusercontent.com",
  "objects.githubusercontent.com",
  "media.githubusercontent.com",
  "repository-images.githubusercontent.com",
  "gist.githubusercontent.com",
  "cloud.githubusercontent.com",
  "github.githubassets.com",
  "opengraph.githubassets.com",
]);

/** GitHub counts each download of a release file where the repository's owner reads it. */
const COUNTED_DOWNLOAD_PATH = /^\/+[^/]+\/+[^/]+\/+releases\//i;

const PERCENT_ESCAPE = /%([0-9a-f]{2})/gi;
const HEX_RADIX = 16;

function readEscapedChar(_escape: string, hex: string): string {
  const code = Number.parseInt(hex, HEX_RADIX);
  return String.fromCodePoint(code);
}

/** A path with each percent escape read as its byte: enough to spell an escaped ASCII segment, and a stray `%` never throws. */
function decodePath(pathname: string): string {
  return pathname.replaceAll(PERCENT_ESCAPE, readEscapedChar);
}

/**
 * The host of an image that neither this instance nor GitHub stores. A
 * browser loading it would tell that host who opened the page and when, so
 * such an image is named and linked, never loaded.
 */
export function readOutsideImageHost(
  source: string | undefined,
): string | undefined {
  if (source?.startsWith(HTTPS_PREFIX) !== true) {
    return undefined;
  }
  try {
    const { hostname, pathname } = new URL(source);
    const path = decodePath(pathname);
    const countsDownloads =
      hostname === GITHUB_HOST && COUNTED_DOWNLOAD_PATH.test(path);
    const storedByGitHub =
      GITHUB_CONTENT_HOSTS.has(hostname) && !countsDownloads;
    return storedByGitHub ? undefined : hostname;
  } catch {
    return undefined;
  }
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

/** The same-origin read that serves `source`; absent, the address is not one the proxy serves. */
export function buildProxyPath(
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

function isSvgAddress(source: string): boolean {
  try {
    const { pathname } = new URL(source);
    return pathname.toLowerCase().endsWith(SVG_EXTENSION);
  } catch {
    return false;
  }
}

/**
 * The strip's resized copy of an image the proxy serves: its proxy path with
 * the thumbnail option. Absent for an SVG, which the read never resizes, and
 * for an address the proxy does not serve.
 */
export function buildThumbnailPath(
  scope: AttachmentScope,
  source: string,
): string | undefined {
  const path = isSvgAddress(source) ? undefined : buildProxyPath(scope, source);
  if (path === undefined) {
    return undefined;
  }
  const query = new URLSearchParams({
    [ATTACHMENT_THUMBNAIL_PARAM]: AttachmentThumbnails.STRIP,
  });
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${query.toString()}`;
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
