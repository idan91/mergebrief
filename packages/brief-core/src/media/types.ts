import type { Brand, ValueOf } from "types/utils";

/** A Media item's identity: its normalised address, or `mermaid:<sha256 hex>` of a diagram's code. */
export type MediaKey = Brand<string, "MediaKey">;

export const MediaKinds = {
  IMAGE: "image",
  VIDEO: "video",
  DIAGRAM: "diagram",
} as const;
export type MediaKind = ValueOf<typeof MediaKinds>;

/** The Mermaid diagram a fence opens with, named for its first keyword. */
export const DiagramTypes = {
  SEQUENCE: "sequence",
  FLOWCHART: "flowchart",
  CLASS: "class",
  STATE: "state",
  ENTITY_RELATIONSHIP: "entity-relationship",
  GANTT: "gantt",
  PIE: "pie",
  JOURNEY: "journey",
  GIT_GRAPH: "git-graph",
  MINDMAP: "mindmap",
  TIMELINE: "timeline",
  OTHER: "other",
} as const;
export type DiagramType = ValueOf<typeof DiagramTypes>;

interface MediaItemBase {
  readonly key: MediaKey;
  /** Alt text, else the table's header cell, else a link's text or the sentence before it, else the file name. */
  readonly caption?: string;
  /** The text of the nearest heading above the item. */
  readonly heading?: string;
}

interface AddressedMediaItem extends MediaItemBase {
  /** The address as the author wrote it, before any normalising; a link to a file's page reads as that file's raw address. */
  readonly address: string;
  /** A link to a file in the pull request's own repository: listed in the strip, left a link in the text. */
  readonly stripOnly: boolean;
}

export interface ImageMediaItem extends AddressedMediaItem {
  readonly kind: typeof MediaKinds.IMAGE;
  readonly alt?: string;
}

export interface VideoMediaItem extends AddressedMediaItem {
  readonly kind: typeof MediaKinds.VIDEO;
  /** A pasted asset alone on its line: a video only once the page confirms GitHub rendered one. */
  readonly requiresConfirmation: boolean;
}

export interface DiagramMediaItem extends MediaItemBase {
  readonly kind: typeof MediaKinds.DIAGRAM;
  readonly code: string;
  readonly diagramType: DiagramType;
}

export type MediaItem = ImageMediaItem | VideoMediaItem | DiagramMediaItem;
/** What a link can be read as: a strip-only file, or a pasted video to confirm. */
export type LinkMediaItem = ImageMediaItem | VideoMediaItem;

export interface ExtractMediaOptions {
  /** The pull request's repository, `owner/name`: a link to a file in it is a Media item. */
  readonly repoSlug: string;
}
