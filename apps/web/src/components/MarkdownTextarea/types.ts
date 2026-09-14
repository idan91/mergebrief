import type { ValueOf } from "types/utils";

export const MarkdownTextareaModes = {
  WRITE: "write",
  PREVIEW: "preview",
} as const;

export type MarkdownTextareaMode = ValueOf<typeof MarkdownTextareaModes>;
