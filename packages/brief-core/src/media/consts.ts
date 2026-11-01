import {
  CommittedMediaExtensions,
  type CommittedMediaExtension,
} from "../media-address";
import {
  DiagramTypes,
  MediaKinds,
  type DiagramType,
  type LinkMediaKind,
} from "./types";

export const HTTPS_PREFIX = "https://";
export const MERMAID_KEY_PREFIX = "mermaid:";
export const MERMAID_LANGUAGE_CLASS = "language-mermaid";

/** The kind each file type the committed-file proxy serves shows as. */
export const MEDIA_KIND_BY_EXTENSION: Readonly<
  Record<CommittedMediaExtension, LinkMediaKind>
> = {
  [CommittedMediaExtensions.PNG]: MediaKinds.IMAGE,
  [CommittedMediaExtensions.JPG]: MediaKinds.IMAGE,
  [CommittedMediaExtensions.JPEG]: MediaKinds.IMAGE,
  [CommittedMediaExtensions.GIF]: MediaKinds.IMAGE,
  [CommittedMediaExtensions.WEBP]: MediaKinds.IMAGE,
  [CommittedMediaExtensions.SVG]: MediaKinds.IMAGE,
  [CommittedMediaExtensions.MP4]: MediaKinds.VIDEO,
  [CommittedMediaExtensions.MOV]: MediaKinds.VIDEO,
  [CommittedMediaExtensions.WEBM]: MediaKinds.VIDEO,
};

export const DIAGRAM_TYPE_BY_KEYWORD: ReadonlyMap<string, DiagramType> =
  new Map([
    ["sequenceDiagram", DiagramTypes.SEQUENCE],
    ["flowchart", DiagramTypes.FLOWCHART],
    ["flowchart-elk", DiagramTypes.FLOWCHART],
    ["graph", DiagramTypes.FLOWCHART],
    ["classDiagram", DiagramTypes.CLASS],
    ["classDiagram-v2", DiagramTypes.CLASS],
    ["stateDiagram", DiagramTypes.STATE],
    ["stateDiagram-v2", DiagramTypes.STATE],
    ["erDiagram", DiagramTypes.ENTITY_RELATIONSHIP],
    ["gantt", DiagramTypes.GANTT],
    ["pie", DiagramTypes.PIE],
    ["journey", DiagramTypes.JOURNEY],
    ["gitGraph", DiagramTypes.GIT_GRAPH],
    ["mindmap", DiagramTypes.MINDMAP],
    ["timeline", DiagramTypes.TIMELINE],
  ]);

export const HEADING_TAG_NAMES: ReadonlySet<string> = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/** The blocks whose text a later link's caption may fall back to. */
export const CAPTION_BLOCK_TAG_NAMES: ReadonlySet<string> = new Set([
  ...HEADING_TAG_NAMES,
  "p",
  "li",
  "td",
  "th",
]);
