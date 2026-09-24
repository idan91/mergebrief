import type { ValueOf } from "types/utils";

export const MarkdownTextareaModes = {
  WRITE: "write",
  PREVIEW: "preview",
} as const;

export type MarkdownTextareaMode = ValueOf<typeof MarkdownTextareaModes>;

export const MarkdownTextareaFrames = {
  /** The bare editor inside a host that draws its own box. */
  PLAIN: "plain",
  /** The comment card: an edge, the label as a header band, the field on the page ground. */
  CARD: "card",
} as const;

export type MarkdownTextareaFrame = ValueOf<typeof MarkdownTextareaFrames>;
