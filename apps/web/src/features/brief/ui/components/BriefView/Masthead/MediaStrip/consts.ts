import { MediaKinds, type MediaKind } from "brief-core/media";
import type { TranslationKey } from "i18n";

/** The order the counts line names the kinds in. */
export const STRIP_KIND_ORDER: readonly MediaKind[] = [
  MediaKinds.IMAGE,
  MediaKinds.VIDEO,
  MediaKinds.DIAGRAM,
];

export const COUNT_KEYS = {
  [MediaKinds.IMAGE]: "brief.media.imageCount",
  [MediaKinds.VIDEO]: "brief.media.videoCount",
  [MediaKinds.DIAGRAM]: "brief.media.diagramCount",
} as const satisfies Readonly<Record<MediaKind, TranslationKey>>;

/** What an image or video with no caption is called. */
export const KIND_LABEL_KEYS = {
  [MediaKinds.IMAGE]: "brief.media.imageLabel",
  [MediaKinds.VIDEO]: "brief.media.videoLabel",
} as const satisfies Readonly<
  Record<typeof MediaKinds.IMAGE | typeof MediaKinds.VIDEO, TranslationKey>
>;

/** The tile's name for an image or video with no caption, which the kind alone names. */
export const OPEN_UNNAMED_KEYS = {
  [MediaKinds.IMAGE]: "brief.media.openUnnamedImage",
  [MediaKinds.VIDEO]: "brief.media.openUnnamedVideo",
} as const satisfies Readonly<
  Record<typeof MediaKinds.IMAGE | typeof MediaKinds.VIDEO, TranslationKey>
>;

/** Instant, as every keyboard step is: a focused tile is never animated into view. */
export const FOCUSED_TILE_SCROLL: ScrollIntoViewOptions = {
  block: "nearest",
  inline: "nearest",
};

export const OPEN_KEYS: Readonly<Record<MediaKind, TranslationKey>> = {
  [MediaKinds.IMAGE]: "brief.media.openImage",
  [MediaKinds.VIDEO]: "brief.media.openVideo",
  [MediaKinds.DIAGRAM]: "brief.media.openDiagram",
};
