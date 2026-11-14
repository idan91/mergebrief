import type { DiagramType, MediaKey, MediaKinds } from "brief-core/media";

import type { MediaLightboxHandle } from "@web/components/Markdown/context";

interface StripEntryBase {
  readonly key: MediaKey;
  /** The extractor's caption; absent, the strip names the entry by its kind. */
  readonly caption?: string;
}

interface AddressedStripEntry extends StripEntryBase {
  /** What the lightbox loads: the proxy's same-origin read, or the address itself on a GitHub host. */
  readonly source: string;
  /** The author's address for "Open on GitHub"; absent off a GitHub host. */
  readonly githubLink?: string;
}

export interface ImageStripEntry extends AddressedStripEntry {
  readonly kind: typeof MediaKinds.IMAGE;
  readonly alt?: string;
  /** The read's resized copy for the tile; absent, the tile loads `source`. */
  readonly thumbnailSource?: string;
}

export interface VideoStripEntry extends AddressedStripEntry {
  readonly kind: typeof MediaKinds.VIDEO;
}

export interface DiagramStripEntry extends StripEntryBase {
  readonly kind: typeof MediaKinds.DIAGRAM;
  readonly code: string;
  readonly diagramType: DiagramType;
}

/** One place in the strip, and the lightbox's sequence, ready to render. */
export type StripEntry = ImageStripEntry | VideoStripEntry | DiagramStripEntry;

/** The description's Media: the strip's entries and the lightbox open over them. */
export interface MediaGallery {
  readonly entries: readonly StripEntry[];
  /** The open entry's place in `entries`; absent while the lightbox is closed. */
  readonly openIndex?: number | undefined;
  /** The control that opened the lightbox; focus returns to it. */
  readonly opener?: HTMLElement | undefined;
  /** Opens the lightbox from a tile, an inline image or a Summary item. */
  readonly lightbox: MediaLightboxHandle;
  /** Moves the open lightbox by `offset` places, wrapping at either end. */
  readonly stepMedia: (offset: number) => void;
  readonly closeMedia: () => void;
}
