import type { ValueOf } from "types/utils";
import type { LineCollector } from "./lines";

/** Every Atlassian Document Format node type the walk has a rule for, spelled as Jira sends it. */
export const AdfNodeTypes = {
  DOC: "doc",
  PARAGRAPH: "paragraph",
  HEADING: "heading",
  BULLET_LIST: "bulletList",
  ORDERED_LIST: "orderedList",
  LIST_ITEM: "listItem",
  TASK_LIST: "taskList",
  TASK_ITEM: "taskItem",
  BLOCK_TASK_ITEM: "blockTaskItem",
  DECISION_LIST: "decisionList",
  DECISION_ITEM: "decisionItem",
  BLOCKQUOTE: "blockquote",
  CODE_BLOCK: "codeBlock",
  PANEL: "panel",
  RULE: "rule",
  TABLE: "table",
  TABLE_ROW: "tableRow",
  TABLE_HEADER: "tableHeader",
  TABLE_CELL: "tableCell",
  EXPAND: "expand",
  NESTED_EXPAND: "nestedExpand",
  MEDIA_SINGLE: "mediaSingle",
  MEDIA_GROUP: "mediaGroup",
  MEDIA: "media",
  MEDIA_INLINE: "mediaInline",
  CAPTION: "caption",
  BLOCK_CARD: "blockCard",
  EMBED_CARD: "embedCard",
  INLINE_CARD: "inlineCard",
  TEXT: "text",
  HARD_BREAK: "hardBreak",
  MENTION: "mention",
  EMOJI: "emoji",
  DATE: "date",
  STATUS: "status",
  PLACEHOLDER: "placeholder",
  SYNC_BLOCK: "syncBlock",
} as const;
export type AdfNodeType = ValueOf<typeof AdfNodeTypes>;

/** What one walk writes into: its lines, and the type names it met without a rule. */
export interface WalkState {
  readonly lines: LineCollector;
  readonly unknownTypes: Set<string>;
}

export interface BlockContext {
  /** Opens every line: two spaces per indent level, `> ` per quote. */
  readonly linePrefix: string;
  readonly indentLevel: number;
  /** How many nodes these blocks sit under; the document itself is 0. */
  readonly depth: number;
}

export interface RenderedDescription {
  readonly text: string;
  /** Node type names the walk had no rule for, first met first; never content. */
  readonly unknownTypes: readonly string[];
}
