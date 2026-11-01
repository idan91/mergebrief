import {
  AttachmentSourceKinds,
  isAttachmentAssetId,
  parseAttachmentFileName,
  parseAttachmentSource,
} from "contract/attachments";
import type { Element } from "hast";
import type { Mutable } from "types/utils";

import {
  buildCommittedFileUrl,
  isCommittedFileInRepository,
  parseCommittedFilePageUrl,
  parseCommittedFileUrl,
  readCommittedMediaExtension,
} from "../../media-address";
import { MEDIA_KIND_BY_EXTENSION, MERMAID_LANGUAGE_CLASS } from "../consts";
import {
  MediaKinds,
  type DiagramMediaItem,
  type ImageMediaItem,
  type LinkMediaItem,
  type LinkMediaKind,
  type VideoMediaItem,
} from "../types";
import { readDiagramType } from "./diagram-type";
import { buildAddressMediaKey, buildMermaidMediaKey } from "./keys";
import {
  readFileName,
  readHttpsProperty,
  readLastSentence,
  readNonBlank,
  readStringProperty,
  readText,
} from "./text";

/** Where an item sits: what its caption and its `<pr_media>` line read from. */
export interface MediaPlace {
  readonly repoSlug: string;
  readonly heading?: string | undefined;
  readonly tableHeader?: string | undefined;
}

/** What a link item reads off the text around it. */
export interface LinkSurroundings {
  readonly textBefore: string;
  readonly aloneOnLine: boolean;
}

interface PlacedItem {
  caption?: string;
  heading?: string;
}

/** An address's file name as a caption, unless it is a pasted asset's id, which names nothing a reader knows. */
function readFileNameCaption(address: string): string | undefined {
  const fileName = readFileName(address);
  if (fileName === undefined || isAttachmentAssetId(fileName)) {
    return undefined;
  }
  return parseAttachmentFileName(fileName).ok ? undefined : fileName;
}

function assignPlace(
  item: PlacedItem,
  place: MediaPlace,
  captions: readonly (string | undefined)[],
): void {
  const caption = captions.find((candidate) => candidate !== undefined);
  if (caption !== undefined) {
    item.caption = caption;
  }
  if (place.heading !== undefined) {
    item.heading = place.heading;
  }
}

export function readImageItem(
  node: Element,
  place: MediaPlace,
): ImageMediaItem | undefined {
  const address = readHttpsProperty(node, "src");
  const key = address === undefined ? undefined : buildAddressMediaKey(address);
  if (address === undefined || key === undefined) {
    return undefined;
  }

  const alt = readNonBlank(readStringProperty(node, "alt"));
  const item: Mutable<ImageMediaItem> = {
    kind: MediaKinds.IMAGE,
    key,
    address,
    stripOnly: false,
  };
  if (alt !== undefined) {
    item.alt = alt;
  }
  assignPlace(item, place, [
    alt,
    place.tableHeader,
    readFileNameCaption(address),
  ]);
  return item;
}

export function readVideoItem(
  node: Element,
  place: MediaPlace,
): VideoMediaItem | undefined {
  const address = readHttpsProperty(node, "src");
  const key = address === undefined ? undefined : buildAddressMediaKey(address);
  if (address === undefined || key === undefined) {
    return undefined;
  }

  const item: Mutable<VideoMediaItem> = {
    kind: MediaKinds.VIDEO,
    key,
    address,
    requiresConfirmation: false,
    stripOnly: false,
  };
  assignPlace(item, place, [place.tableHeader, readFileNameCaption(address)]);
  return item;
}

function isPastedAssetLine(
  address: string,
  linkText: string | undefined,
  surroundings: LinkSurroundings,
): boolean {
  const source = parseAttachmentSource(address);
  const isAsset =
    source.ok && source.value.kind === AttachmentSourceKinds.ASSET;
  return isAsset && linkText === address && surroundings.aloneOnLine;
}

function readRepositoryFileKind(
  address: string,
  repoSlug: string,
): LinkMediaKind | undefined {
  const source = parseCommittedFileUrl(address);
  if (!source.ok || !isCommittedFileInRepository(source.value, repoSlug)) {
    return undefined;
  }
  const extension = readCommittedMediaExtension(source.value.pathSegments);
  return extension === undefined
    ? undefined
    : MEDIA_KIND_BY_EXTENSION[extension];
}

/** A link to a committed file's page, as that file's raw address; any other link as written. */
function readLinkTarget(written: string): string {
  const page = parseCommittedFilePageUrl(written);
  return page.ok ? buildCommittedFileUrl(page.value) : written;
}

/**
 * A pasted asset alone on its line is a video to confirm; a link to an image
 * or video file in the pull request's own repository, raw or its file page,
 * is a strip-only item.
 */
export function readLinkItem(
  node: Element,
  place: MediaPlace,
  surroundings: LinkSurroundings,
): LinkMediaItem | undefined {
  const written = readHttpsProperty(node, "href");
  const address = written === undefined ? undefined : readLinkTarget(written);
  const key = address === undefined ? undefined : buildAddressMediaKey(address);
  if (written === undefined || address === undefined || key === undefined) {
    return undefined;
  }

  const linkText = readNonBlank(readText(node));
  const pastedAsset = isPastedAssetLine(written, linkText, surroundings);
  const kind = pastedAsset
    ? MediaKinds.VIDEO
    : readRepositoryFileKind(address, place.repoSlug);
  if (kind === undefined) {
    return undefined;
  }

  const ownText = linkText === written ? undefined : linkText;
  const captions = [
    place.tableHeader,
    ownText,
    readLastSentence(surroundings.textBefore),
    readFileNameCaption(address),
  ];
  const stripOnly = !pastedAsset;
  if (kind === MediaKinds.VIDEO) {
    const video: Mutable<VideoMediaItem> = {
      kind,
      key,
      address,
      requiresConfirmation: pastedAsset,
      stripOnly,
    };
    assignPlace(video, place, captions);
    return video;
  }

  const image: Mutable<ImageMediaItem> = { kind, key, address, stripOnly };
  assignPlace(image, place, captions);
  return image;
}

function isMermaidCode(node: Element): boolean {
  const classNames = node.properties["className"];
  const isCode = node.tagName === "code" && Array.isArray(classNames);
  return isCode && classNames.includes(MERMAID_LANGUAGE_CLASS);
}

/** A `pre` holding a `language-mermaid` code element. */
export function readDiagramItem(
  node: Element,
  place: MediaPlace,
): DiagramMediaItem | undefined {
  const codeElement = node.children.find(
    (child): child is Element => child.type === "element",
  );
  if (codeElement === undefined || !isMermaidCode(codeElement)) {
    return undefined;
  }
  const code = readText(codeElement);
  if (readNonBlank(code) === undefined) {
    return undefined;
  }

  const item: Mutable<DiagramMediaItem> = {
    kind: MediaKinds.DIAGRAM,
    key: buildMermaidMediaKey(code),
    code,
    diagramType: readDiagramType(code),
  };
  assignPlace(item, place, [place.tableHeader]);
  return item;
}
