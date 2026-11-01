import { DiagramTypes, type DiagramType } from "brief-core/media";
import type { TranslationKey } from "i18n";

import type { DesignToken } from "./types";

/** Unique on the page: Mermaid removes any element already holding a render's id, or that id prefixed `i` or `d`. */
export const DIAGRAM_RENDER_ID_PREFIX = "mergebrief-diagram-";

/** The ids and class Mermaid gives what it adds to the page body while it draws. */
export const MERMAID_SANDBOX_FRAME_ID_PREFIX = "i";
export const MERMAID_ENCLOSING_ID_PREFIX = "d";
export const MERMAID_LAYOUT_CONTAINER_ID = "cy";
export const MERMAID_TOOLTIP_CLASS = "mermaidTooltip";
/** Mermaid's sandbox mode appends a full-size working frame to the element it draws in. */
export const DIAGRAM_DRAW_CONTAINER_ID = "mergebrief-diagram-draw";
/** Laid out so Mermaid can measure text, out of the page's flow and never seen. */
export const DIAGRAM_DRAW_CONTAINER_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  insetBlockStart: "0",
  insetInlineStart: "-200vw",
  inlineSize: "100vw",
  blockSize: "100vh",
  visibility: "hidden",
  pointerEvents: "none",
};

/** How Mermaid's sandbox mode addresses the page it draws in. */
export const SANDBOX_FRAME_SOURCE_PREFIX =
  "data:text/html;charset=UTF-8;base64,";

/** The frame holds no web font, so Mermaid measures and draws in the system sans. */
export const DIAGRAM_FONT_FAMILY =
  // oxlint-disable-next-line house/no-shout-case-copy -- a CSS font stack, never read as text
  'system-ui, -apple-system, "Helvetica Neue", sans-serif';
export const DIAGRAM_FONT_SIZE_TOKEN: DesignToken = "--font-size-lg";
/** The app's smallest text: a frame never draws a diagram's text smaller. */
export const DIAGRAM_MIN_FONT_SIZE_TOKEN: DesignToken = "--font-size-xs";
/** Mermaid 12 defaults to ELK, a lazy chunk of about 1.5 MB; dagre's chunk is far smaller. */
export const MERMAID_LAYOUT = "dagre";
/** What Mermaid draws text at when its theme names no size. */
export const MERMAID_DEFAULT_FONT_PIXELS = 16;

/** Every shape's outline: 6:1 on the frame's ground, above the 3:1 a boundary needs. */
const SHAPE_BORDER_TOKEN: DesignToken = "--color-text-3";

/** Mermaid's theme variables, each read from the design token it follows. */
export const DIAGRAM_THEME_TOKENS: Readonly<Record<string, DesignToken>> = {
  background: "--color-background",
  primaryColor: "--color-surface-2",
  primaryTextColor: "--color-text-1",
  primaryBorderColor: SHAPE_BORDER_TOKEN,
  secondaryBorderColor: SHAPE_BORDER_TOKEN,
  tertiaryBorderColor: SHAPE_BORDER_TOKEN,
  nodeBorder: SHAPE_BORDER_TOKEN,
  secondaryColor: "--color-surface-1",
  tertiaryColor: "--color-surface-1",
  lineColor: "--color-text-3",
  textColor: "--color-text-2",
  noteBkgColor: "--color-surface-3",
  noteTextColor: "--color-text-1",
  noteBorderColor: SHAPE_BORDER_TOKEN,
  actorBkg: "--color-surface-2",
  actorBorder: SHAPE_BORDER_TOKEN,
  actorTextColor: "--color-text-1",
  actorLineColor: "--color-text-4",
  signalColor: "--color-text-3",
  signalTextColor: "--color-text-2",
  labelBoxBkgColor: "--color-surface-1",
  labelBoxBorderColor: SHAPE_BORDER_TOKEN,
  labelTextColor: "--color-text-1",
  loopTextColor: "--color-text-2",
  edgeLabelBackground: "--color-background",
  clusterBkg: "--color-surface-1",
  clusterBorder: SHAPE_BORDER_TOKEN,
};

export const DIAGRAM_TITLE_KEYS: Readonly<Record<DiagramType, TranslationKey>> =
  {
    [DiagramTypes.SEQUENCE]: "shell.media.diagramTypes.sequence",
    [DiagramTypes.FLOWCHART]: "shell.media.diagramTypes.flowchart",
    [DiagramTypes.CLASS]: "shell.media.diagramTypes.class",
    [DiagramTypes.STATE]: "shell.media.diagramTypes.state",
    [DiagramTypes.ENTITY_RELATIONSHIP]:
      "shell.media.diagramTypes.entityRelationship",
    [DiagramTypes.GANTT]: "shell.media.diagramTypes.gantt",
    [DiagramTypes.PIE]: "shell.media.diagramTypes.pie",
    [DiagramTypes.JOURNEY]: "shell.media.diagramTypes.journey",
    [DiagramTypes.GIT_GRAPH]: "shell.media.diagramTypes.gitGraph",
    [DiagramTypes.MINDMAP]: "shell.media.diagramTypes.mindmap",
    [DiagramTypes.TIMELINE]: "shell.media.diagramTypes.timeline",
    [DiagramTypes.OTHER]: "shell.media.diagramTypes.other",
  };
