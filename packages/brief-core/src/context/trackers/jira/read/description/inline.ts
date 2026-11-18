import { hasMark, type AdfNode } from "./schemas";
import { AdfNodeTypes, type AdfNodeType, type WalkState } from "./types";
import { noteUnknownType, readChildren, readStringAttr } from "./utils";

const STRIKE_MARK = "strike";
const STRIKE_WRAP = "~~";
/** A mention is only ever its text: `attrs.id` is an account id. */
const UNNAMED_MENTION = "@user";
const EXTERNAL_MEDIA = "external";
/** Jira sends a date as a string of milliseconds since the epoch. */
const TIMESTAMP = /^\d{1,15}$/;
/** Past year 9999 the ISO form no longer opens on `YYYY-MM-DD`. */
const MAX_TIMESTAMP_MS = Date.parse("9999-12-31T23:59:59.999Z");
const ISO_DAY_LENGTH = "YYYY-MM-DD".length;

type InlineWriter = (node: AdfNode) => string;

/** Struck text is wrapped; every other mark keeps the text and is dropped. */
function renderText(node: AdfNode): string {
  const text = node.text ?? "";
  if (text === "") {
    return text;
  }
  const isStruck = hasMark(node, STRIKE_MARK);
  return isStruck ? `${STRIKE_WRAP}${text}${STRIKE_WRAP}` : text;
}

function renderHardBreak(): string {
  return "\n";
}

function renderNothing(): string {
  return "";
}

function renderMention(node: AdfNode): string {
  return readStringAttr(node, "text") ?? UNNAMED_MENTION;
}

function renderEmoji(node: AdfNode): string {
  const text = readStringAttr(node, "text");
  return text ?? readStringAttr(node, "shortName") ?? "";
}

/** The UTC day of a date node; nothing for a timestamp that names no such day. */
function renderDate(node: AdfNode): string {
  const timestamp = readStringAttr(node, "timestamp");
  if (timestamp === undefined || !TIMESTAMP.test(timestamp)) {
    return "";
  }
  const milliseconds = Number(timestamp);
  if (milliseconds > MAX_TIMESTAMP_MS) {
    return "";
  }
  return new Date(milliseconds).toISOString().slice(0, ISO_DAY_LENGTH);
}

function renderStatus(node: AdfNode): string {
  const text = readStringAttr(node, "text");
  return text === undefined ? "" : `[${text}]`;
}

function renderInlineCard(node: AdfNode): string {
  return readStringAttr(node, "url") ?? "";
}

/** `[attachment: <alt>]`, `[attachment: <url>]` for external media with no alt text, else `[attachment]`. */
export function renderMediaMarker(node: AdfNode): string {
  const isExternal = node.attrs["type"] === EXTERNAL_MEDIA;
  const url = isExternal ? readStringAttr(node, "url") : undefined;
  const named = readStringAttr(node, "alt") ?? url;
  return named === undefined ? "[attachment]" : `[attachment: ${named}]`;
}

/** Keyed by the vocabulary, looked up by whatever type a node claims. */
const INLINE_WRITERS: ReadonlyMap<string, InlineWriter> = new Map<
  AdfNodeType,
  InlineWriter
>([
  [AdfNodeTypes.TEXT, renderText],
  [AdfNodeTypes.HARD_BREAK, renderHardBreak],
  [AdfNodeTypes.MENTION, renderMention],
  [AdfNodeTypes.EMOJI, renderEmoji],
  [AdfNodeTypes.DATE, renderDate],
  [AdfNodeTypes.STATUS, renderStatus],
  [AdfNodeTypes.INLINE_CARD, renderInlineCard],
  [AdfNodeTypes.MEDIA_INLINE, renderMediaMarker],
  [AdfNodeTypes.PLACEHOLDER, renderNothing],
]);

/** Whether a node of this type is written inside a line, not as a line of its own. */
export function isInlineType(type: string): boolean {
  return INLINE_WRITERS.has(type);
}

/** A node with no inline rule: its children in line, else its text attribute, else nothing. */
function renderUnruledNode(
  node: AdfNode,
  depth: number,
  state: WalkState,
): string {
  noteUnknownType(node.type, state.unknownTypes);
  if (node.content !== undefined) {
    return renderInlineText(readChildren(node, depth), depth + 1, state);
  }
  return readStringAttr(node, "text") ?? "";
}

/**
 * The text of inline nodes sitting `depth` levels under the document, a hard
 * break as a newline. Stops once it holds what the lines have room for.
 */
export function renderInlineText(
  nodes: Iterable<AdfNode>,
  depth: number,
  state: WalkState,
): string {
  let text = "";
  for (const node of nodes) {
    const write = INLINE_WRITERS.get(node.type);
    text +=
      write === undefined ? renderUnruledNode(node, depth, state) : write(node);
    if (text.length >= state.lines.remaining) {
      break;
    }
  }
  return text;
}
