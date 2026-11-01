import type { DiagramType, MediaKey, MediaKinds } from "brief-core/media";

interface StripEntryBase {
  readonly key: MediaKey;
  /** The extractor's caption; absent, the strip names the entry by its kind. */
  readonly caption?: string;
}

interface AddressedStripEntry extends StripEntryBase {
  /** What the lightbox loads: the proxy's same-origin read, or the address itself on an outside host. */
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
