import { INDENT, MAX_INDENT_LEVELS } from "./consts";
import { isInlineType, renderInlineText, renderMediaMarker } from "./inline";
import { LineCollector } from "./lines";
import { parseNode, type AdfNode } from "./schemas";
import {
  AdfNodeTypes,
  type AdfNodeType,
  type BlockContext,
  type RenderedDescription,
  type WalkState,
} from "./types";
import { noteUnknownType, readChildren, readStringAttr } from "./utils";

const CODE_FENCE = "```";
/** A fence language is one short word; anything else is left out, so it cannot open a line of its own. */
const CODE_LANGUAGE = /^[^\s`]{1,40}$/;
const QUOTE_PREFIX = "> ";
const BULLET_MARKER = "- ";
const DONE_MARKER = "[x] ";
const OPEN_MARKER = "[ ] ";
const DONE_STATE = "DONE";
const CELL_SEPARATOR = " | ";
const HEADING_MARK = "#";
const MIN_HEADING_LEVEL = 1;
const MAX_HEADING_LEVEL = 6;
const DEFAULT_LIST_START = 1;

const ROOT_CONTEXT: BlockContext = { linePrefix: "", indentLevel: 0, depth: 0 };

type BlockWriter = (
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
) => void;

/** A list item's opening text and the blocks after it. */
interface ItemParts {
  readonly text: string;
  readonly rest: readonly AdfNode[];
}

function deepenContext(context: BlockContext): BlockContext {
  return { ...context, depth: context.depth + 1 };
}

function indentContext(context: BlockContext): BlockContext {
  if (context.indentLevel >= MAX_INDENT_LEVELS) {
    return context;
  }
  return {
    ...context,
    linePrefix: `${context.linePrefix}${INDENT}`,
    indentLevel: context.indentLevel + 1,
  };
}

/**
 * One line per line of `text`, `marker` opening the first; a blank line is
 * dropped and so are the spaces a line ends on. Answers whether it wrote.
 */
function writeTextLines(
  text: string,
  context: BlockContext,
  state: WalkState,
  marker = "",
): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");

  lines.forEach((line, index) => {
    const opening = index === 0 ? marker : "";
    state.lines.add(`${context.linePrefix}${opening}${line}`);
  });
  return lines.length > 0;
}

function renderChildText(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): string {
  const children = readChildren(node, context.depth);
  return renderInlineText(children, context.depth + 1, state);
}

function writeChildren(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  const children = readChildren(node, context.depth);
  writeBlocks(children, deepenContext(context), state);
}

function writeParagraph(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  writeTextLines(renderChildText(node, context, state), context, state);
}

function readHeadingLevel(node: AdfNode): number {
  const level = node.attrs["level"];
  if (typeof level !== "number" || !Number.isInteger(level)) {
    return MIN_HEADING_LEVEL;
  }
  return Math.min(Math.max(level, MIN_HEADING_LEVEL), MAX_HEADING_LEVEL);
}

function writeHeading(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  const marker = `${HEADING_MARK.repeat(readHeadingLevel(node))} `;
  const text = renderChildText(node, context, state);
  writeTextLines(text, context, state, marker);
}

/** An item opens on its first paragraph, or on the inline nodes it starts with. */
function readItemParts(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): ItemParts {
  const children = [...readChildren(node, context.depth)];
  const childDepth = context.depth + 1;
  const [first] = children;

  if (first?.type === AdfNodeTypes.PARAGRAPH) {
    const inline = readChildren(first, childDepth);
    const text = renderInlineText(inline, childDepth + 1, state);
    return { text, rest: children.slice(1) };
  }
  const firstBlock = children.findIndex((child) => !isInlineType(child.type));
  const openingEnd = firstBlock === -1 ? children.length : firstBlock;
  const opening = children.slice(0, openingEnd);
  return {
    text: renderInlineText(opening, childDepth, state),
    rest: children.slice(openingEnd),
  };
}

/** The marker plus the item's opening text, then every other child one level deeper. */
function writeItem(
  node: AdfNode,
  marker: string,
  context: BlockContext,
  state: WalkState,
): void {
  const { text, rest } = readItemParts(node, context, state);

  const wroteOpening = writeTextLines(text, context, state, marker);
  const needsBareMarker = !wroteOpening && rest.length > 0;
  if (needsBareMarker) {
    state.lines.add(`${context.linePrefix}${marker.trimEnd()}`);
  }
  const restContext = indentContext(deepenContext(context));
  writeBlocks(rest, restContext, state);
}

function writeListItems(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
  formatMarker: (itemIndex: number) => string,
): void {
  const itemContext = deepenContext(context);
  let itemIndex = 0;

  for (const child of readChildren(node, context.depth)) {
    if (child.type === AdfNodeTypes.LIST_ITEM) {
      writeItem(child, formatMarker(itemIndex), itemContext, state);
      itemIndex += 1;
    } else {
      writeBlocks([child], itemContext, state);
    }
    if (state.lines.full) {
      return;
    }
  }
}

function writeBulletList(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  writeListItems(node, context, state, () => BULLET_MARKER);
}

function readListStart(node: AdfNode): number {
  const order = node.attrs["order"];
  const isStart =
    typeof order === "number" && Number.isSafeInteger(order) && order >= 0;
  return isStart ? order : DEFAULT_LIST_START;
}

function writeOrderedList(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  const start = readListStart(node);
  writeListItems(node, context, state, (itemIndex) => `${start + itemIndex}. `);
}

/** A list item outside any list, and a decision, whose state is dropped. */
function writeBulletItem(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  writeItem(node, BULLET_MARKER, context, state);
}

function writeTaskItem(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  const isDone = node.attrs["state"] === DONE_STATE;
  writeItem(node, isDone ? DONE_MARKER : OPEN_MARKER, context, state);
}

/** The items at this depth; a task list nested among them one level deeper. */
function writeTaskList(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  const itemContext = deepenContext(context);
  const nestedContext = indentContext(itemContext);

  for (const child of readChildren(node, context.depth)) {
    const isNested = child.type === AdfNodeTypes.TASK_LIST;
    writeBlocks([child], isNested ? nestedContext : itemContext, state);
    if (state.lines.full) {
      return;
    }
  }
}

function writeBlockquote(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  const quoted: BlockContext = {
    ...deepenContext(context),
    linePrefix: `${context.linePrefix}${QUOTE_PREFIX}`,
  };
  writeBlocks(readChildren(node, context.depth), quoted, state);
}

function readCodeLanguage(node: AdfNode): string {
  const language = readStringAttr(node, "language");
  const isOneWord = language !== undefined && CODE_LANGUAGE.test(language);
  return isOneWord ? language : "";
}

/** Fenced, the code lines as written: no mark applies and no line is dropped. */
function writeCodeBlock(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  const { linePrefix } = context;
  let code = "";
  for (const child of readChildren(node, context.depth)) {
    code += child.text ?? "";
  }

  state.lines.add(`${linePrefix}${CODE_FENCE}${readCodeLanguage(node)}`);
  const codeLines = code === "" ? [] : code.split("\n");
  for (const line of codeLines) {
    state.lines.add(`${linePrefix}${line}`);
  }
  state.lines.add(`${linePrefix}${CODE_FENCE}`);
}

/** A cell's blocks as one line: written on their own, then joined by a space. */
function renderCell(cell: AdfNode, depth: number, state: WalkState): string {
  const cellState: WalkState = {
    lines: new LineCollector(state.lines.remaining),
    unknownTypes: state.unknownTypes,
  };
  writeBlocks([cell], { ...ROOT_CONTEXT, depth }, cellState);

  const cellLines = cellState.lines.toLines();
  return cellLines.map((line) => line.trim()).join(" ");
}

/** One line per row; an empty cell keeps its place, a row of empty cells gives no line. */
function writeTableRow(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  const cellDepth = context.depth + 1;
  const cells: string[] = [];
  for (const cell of readChildren(node, context.depth)) {
    cells.push(renderCell(cell, cellDepth, state));
  }

  if (cells.some((cell) => cell !== "")) {
    state.lines.add(`${context.linePrefix}${cells.join(CELL_SEPARATOR)}`);
  }
}

function writeExpand(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  writeTextLines(readStringAttr(node, "title") ?? "", context, state);
  const bodyContext = indentContext(deepenContext(context));
  writeBlocks(readChildren(node, context.depth), bodyContext, state);
}

function writeMedia(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  writeTextLines(renderMediaMarker(node), context, state);
}

function writeCard(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  writeTextLines(readStringAttr(node, "url") ?? "", context, state);
}

function writeNothing(): void {}

/** Keyed by the vocabulary, looked up by whatever type a node claims. */
const BLOCK_WRITERS: ReadonlyMap<string, BlockWriter> = new Map<
  AdfNodeType,
  BlockWriter
>([
  [AdfNodeTypes.PARAGRAPH, writeParagraph],
  [AdfNodeTypes.CAPTION, writeParagraph],
  [AdfNodeTypes.HEADING, writeHeading],
  [AdfNodeTypes.BULLET_LIST, writeBulletList],
  [AdfNodeTypes.ORDERED_LIST, writeOrderedList],
  [AdfNodeTypes.LIST_ITEM, writeBulletItem],
  [AdfNodeTypes.DECISION_ITEM, writeBulletItem],
  [AdfNodeTypes.TASK_LIST, writeTaskList],
  [AdfNodeTypes.TASK_ITEM, writeTaskItem],
  [AdfNodeTypes.BLOCK_TASK_ITEM, writeTaskItem],
  [AdfNodeTypes.BLOCKQUOTE, writeBlockquote],
  [AdfNodeTypes.CODE_BLOCK, writeCodeBlock],
  [AdfNodeTypes.TABLE_ROW, writeTableRow],
  [AdfNodeTypes.EXPAND, writeExpand],
  [AdfNodeTypes.NESTED_EXPAND, writeExpand],
  [AdfNodeTypes.MEDIA, writeMedia],
  [AdfNodeTypes.BLOCK_CARD, writeCard],
  [AdfNodeTypes.EMBED_CARD, writeCard],
  [AdfNodeTypes.RULE, writeNothing],
  [AdfNodeTypes.SYNC_BLOCK, writeNothing],
  // No line of their own: the children are written where the node sits.
  [AdfNodeTypes.DOC, writeChildren],
  [AdfNodeTypes.PANEL, writeChildren],
  [AdfNodeTypes.DECISION_LIST, writeChildren],
  [AdfNodeTypes.TABLE, writeChildren],
  [AdfNodeTypes.TABLE_HEADER, writeChildren],
  [AdfNodeTypes.TABLE_CELL, writeChildren],
  [AdfNodeTypes.MEDIA_SINGLE, writeChildren],
  [AdfNodeTypes.MEDIA_GROUP, writeChildren],
]);

/** A node with no rule: its children in place at the same depth, else its text attribute, else nothing. */
function writeBlock(
  node: AdfNode,
  context: BlockContext,
  state: WalkState,
): void {
  const write = BLOCK_WRITERS.get(node.type);
  if (write !== undefined) {
    write(node, context, state);
    return;
  }

  noteUnknownType(node.type, state.unknownTypes);
  if (node.content !== undefined) {
    writeChildren(node, context, state);
    return;
  }
  writeTextLines(readStringAttr(node, "text") ?? "", context, state);
}

function writeInlineRun(
  inlineRun: readonly AdfNode[],
  context: BlockContext,
  state: WalkState,
): void {
  if (inlineRun.length === 0) {
    return;
  }
  const text = renderInlineText(inlineRun, context.depth, state);
  writeTextLines(text, context, state);
}

/**
 * The nodes in order. Inline nodes that sit side by side among blocks share
 * one line. Once the lines hold the cap no further node is read, so the
 * check follows each write, before the next node is asked for.
 */
function writeBlocks(
  nodes: Iterable<AdfNode>,
  context: BlockContext,
  state: WalkState,
): void {
  if (state.lines.full) {
    return;
  }
  let inlineRun: AdfNode[] = [];

  for (const node of nodes) {
    if (isInlineType(node.type)) {
      inlineRun.push(node);
      continue;
    }
    writeInlineRun(inlineRun, context, state);
    inlineRun = [];
    writeBlock(node, context, state);
    if (state.lines.full) {
      return;
    }
  }
  writeInlineRun(inlineRun, context, state);
}

/**
 * A Jira description, an Atlassian Document Format tree, as plain text: one
 * line per block, nested content indented two spaces a level, cut at
 * `maxChars`. Nothing in the tree throws or is printed as JSON; a node with
 * no rule gives its children or its text attribute.
 */
export function renderDescription(
  tree: unknown,
  maxChars: number,
): RenderedDescription {
  const state: WalkState = {
    lines: new LineCollector(maxChars),
    unknownTypes: new Set(),
  };
  const root = parseNode(tree);
  if (root !== undefined) {
    writeBlocks([root], ROOT_CONTEXT, state);
  }
  return { text: state.lines.render(), unknownTypes: [...state.unknownTypes] };
}
