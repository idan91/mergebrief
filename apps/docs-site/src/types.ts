import type { MarkdownRenderer } from "vitepress";

/** A markdown-it core rule as VitePress's renderer takes one. */
export type CoreRule = Parameters<MarkdownRenderer["core"]["ruler"]["push"]>[1];

export type CoreState = Parameters<CoreRule>[0];
