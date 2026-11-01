import {
  DiagramTypes,
  MediaKinds,
  type DiagramType,
  type MediaKind,
} from "./types";

export const HTTPS_PREFIX = "https://";
export const MERMAID_KEY_PREFIX = "mermaid:";
export const MERMAID_LANGUAGE_CLASS = "language-mermaid";

/** The file types a link to the pull request's own repository can show as Media. */
export const MEDIA_KIND_BY_EXTENSION: ReadonlyMap<string, MediaKind> = new Map([
  ["png", MediaKinds.IMAGE],
  ["jpg", MediaKinds.IMAGE],
  ["jpeg", MediaKinds.IMAGE],
  ["gif", MediaKinds.IMAGE],
  ["webp", MediaKinds.IMAGE],
  ["svg", MediaKinds.IMAGE],
  ["mp4", MediaKinds.VIDEO],
  ["mov", MediaKinds.VIDEO],
  ["webm", MediaKinds.VIDEO],
]);

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
