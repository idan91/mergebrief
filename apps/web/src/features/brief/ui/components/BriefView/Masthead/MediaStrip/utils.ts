import {
  MediaKinds,
  type DiagramMediaItem,
  type ImageMediaItem,
  type MediaItem,
  type MediaKind,
  type VideoMediaItem,
} from "brief-core/media";
import { parseAttachmentAssetId, type AttachmentAssetId } from "contract";
import type { TFunction } from "i18next";
import type { Mutable } from "types/utils";

import type { AttachmentScope } from "@web/components/Markdown/context";
import {
  buildProxyPath,
  buildThumbnailPath,
  readOutsideImageHost,
} from "@web/components/Markdown/media";
import { DIAGRAM_TITLE_KEYS } from "@web/components/MermaidDiagram/consts";
import { buildGitHubOriginalLink } from "@web/components/MediaFailedRow/utils";
import {
  COUNT_KEYS,
  KIND_LABEL_KEYS,
  OPEN_KEYS,
  OPEN_UNNAMED_KEYS,
  STRIP_KIND_ORDER,
} from "./consts";
import type {
  DiagramStripEntry,
  ImageStripEntry,
  StripEntry,
  VideoStripEntry,
} from "./types";

function readServedSource(
  scope: AttachmentScope | undefined,
  address: string,
): string | undefined {
  return scope === undefined ? undefined : buildProxyPath(scope, address);
}

/** An image on an outside host stays a link in the text and out of the strip, as a video does. */
function buildImageEntry(
  item: ImageMediaItem,
  scope: AttachmentScope | undefined,
): ImageStripEntry | undefined {
  const servedSource = readServedSource(scope, item.address);
  const isOutside = readOutsideImageHost(item.address) !== undefined;
  const staysOutOfStrip = servedSource === undefined && isOutside;
  if (staysOutOfStrip) {
    return undefined;
  }

  const entry: Mutable<ImageStripEntry> = {
    kind: MediaKinds.IMAGE,
    key: item.key,
    source: servedSource ?? item.address,
  };
  const thumbnailSource =
    scope === undefined ? undefined : buildThumbnailPath(scope, item.address);
  const githubLink = buildGitHubOriginalLink(item.address);

  if (item.caption !== undefined) {
    entry.caption = item.caption;
  }
  if (item.alt !== undefined) {
    entry.alt = item.alt;
  }
  if (thumbnailSource !== undefined) {
    entry.thumbnailSource = thumbnailSource;
  }
  if (githubLink !== undefined) {
    entry.githubLink = githubLink;
  }

  return entry;
}

function isConfirmedVideo(
  item: VideoMediaItem,
  videoAssetIds: ReadonlySet<AttachmentAssetId> | undefined,
): boolean {
  if (!item.requiresConfirmation) {
    return true;
  }
  const assetId = parseAttachmentAssetId(item.address);
  const renderedAsVideo =
    assetId.ok && videoAssetIds?.has(assetId.value) === true;
  return renderedAsVideo;
}

/** A video plays only through the proxy; any other host stays a link in the text and out of the strip. */
function buildVideoEntry(
  item: VideoMediaItem,
  scope: AttachmentScope | undefined,
  videoAssetIds: ReadonlySet<AttachmentAssetId> | undefined,
): VideoStripEntry | undefined {
  const source = readServedSource(scope, item.address);
  const confirmed = isConfirmedVideo(item, videoAssetIds);
  if (source === undefined || !confirmed) {
    return undefined;
  }

  const entry: Mutable<VideoStripEntry> = {
    kind: MediaKinds.VIDEO,
    key: item.key,
    source,
  };
  const githubLink = buildGitHubOriginalLink(item.address);
  if (item.caption !== undefined) {
    entry.caption = item.caption;
  }
  if (githubLink !== undefined) {
    entry.githubLink = githubLink;
  }
  return entry;
}

function buildDiagramEntry(item: DiagramMediaItem): DiagramStripEntry {
  const entry: Mutable<DiagramStripEntry> = {
    kind: MediaKinds.DIAGRAM,
    key: item.key,
    code: item.code,
    diagramType: item.diagramType,
  };
  if (item.caption !== undefined) {
    entry.caption = item.caption;
  }
  return entry;
}

function buildStripEntry(
  item: MediaItem,
  scope: AttachmentScope | undefined,
  videoAssetIds: ReadonlySet<AttachmentAssetId> | undefined,
): StripEntry | undefined {
  switch (item.kind) {
    case MediaKinds.IMAGE:
      return buildImageEntry(item, scope);
    case MediaKinds.VIDEO:
      return buildVideoEntry(item, scope, videoAssetIds);
    case MediaKinds.DIAGRAM:
      return buildDiagramEntry(item);
  }
}

/**
 * The strip's entries in document order. A pasted asset line joins only once
 * GitHub confirms it rendered a video, and neither a video the proxy cannot
 * serve nor an image on an outside host ever joins.
 */
export function buildStripEntries(
  items: readonly MediaItem[],
  scope: AttachmentScope | undefined,
  videoAssetIds: ReadonlySet<AttachmentAssetId> | undefined,
): StripEntry[] {
  return items.flatMap((item) => {
    const entry = buildStripEntry(item, scope, videoAssetIds);
    return entry === undefined ? [] : [entry];
  });
}

/** The asset ids of pasted lines the strip lists only once GitHub confirms them videos. */
export function readPendingVideoAssetIds(
  items: readonly MediaItem[],
): AttachmentAssetId[] {
  return items.flatMap((item) => {
    if (item.kind !== MediaKinds.VIDEO || !item.requiresConfirmation) {
      return [];
    }
    const assetId = parseAttachmentAssetId(item.address);
    return assetId.ok ? [assetId.value] : [];
  });
}

function countEntries(entries: readonly StripEntry[], kind: MediaKind): number {
  return entries.filter((entry) => entry.kind === kind).length;
}

/** "4 images, 3 videos, 1 diagram from the description", naming only the kinds present. */
export function describeStripCounts(
  t: TFunction,
  entries: readonly StripEntry[],
  locale: string,
): string {
  const parts = STRIP_KIND_ORDER.flatMap((kind) => {
    const count = countEntries(entries, kind);
    return count === 0 ? [] : [t(COUNT_KEYS[kind], { count })];
  });
  const counts = new Intl.ListFormat(locale, {
    style: "short",
    type: "unit",
  }).format(parts);
  return `${counts} ${t("brief.media.countsSuffix")}`;
}

/** The entry's caption, else a diagram's type or the kind's name. */
export function readEntryLabel(t: TFunction, entry: StripEntry): string {
  if (entry.caption !== undefined) {
    return entry.caption;
  }
  if (entry.kind === MediaKinds.DIAGRAM) {
    return t(DIAGRAM_TITLE_KEYS[entry.diagramType]);
  }
  return t(KIND_LABEL_KEYS[entry.kind]);
}

/** The tile's name: "Open image: <caption>", or the kind alone for an image or video with no caption. */
export function readOpenLabel(t: TFunction, entry: StripEntry): string {
  if (entry.caption === undefined && entry.kind !== MediaKinds.DIAGRAM) {
    return t(OPEN_UNNAMED_KEYS[entry.kind]);
  }
  return t(OPEN_KEYS[entry.kind], { caption: readEntryLabel(t, entry) });
}

/** What an image tile loads: its thumbnail where the proxy makes one; only the lightbox loads the original. */
export function readTileSource(entry: ImageStripEntry): string {
  return entry.thumbnailSource ?? entry.source;
}

/** `index` moved by `offset` places in a sequence of `count`, wrapping at either end. */
export function stepIndex(
  index: number,
  offset: number,
  count: number,
): number {
  return (((index + offset) % count) + count) % count;
}
