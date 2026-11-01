import type { Element, ElementContent, Root, RootContent } from "hast";

import { HTTPS_PREFIX } from "../consts";

const WHITESPACE_RUN = /\s+/g;
const SENTENCE_BREAK = /(?<=[.!?])\s+/;
const TRAILING_COLON = /:$/;
/** Markdown ends a line at `\n`, `\r\n` or a lone `\r`, and keeps the break in the text. */
const LINE_END = /[\r\n][ \t]*$/;
const LINE_START = /^[ \t]*[\r\n]/;

/** The text content of a sanitized node, every descendant included. */
export function readText(node: Root | RootContent): string {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type !== "element" && node.type !== "root") {
    return "";
  }
  return node.children.map(readText).join("");
}

/** `text` with whitespace runs collapsed, or absent when nothing is left. */
export function readNonBlank(text: string | undefined): string | undefined {
  const collapsed = text?.replace(WHITESPACE_RUN, " ").trim() ?? "";
  return collapsed === "" ? undefined : collapsed;
}

/** The last sentence of `text`, a trailing colon dropped. */
export function readLastSentence(text: string): string | undefined {
  const sentences = readNonBlank(text)?.split(SENTENCE_BREAK) ?? [];
  const last = sentences.at(-1)?.replace(TRAILING_COLON, "");
  return readNonBlank(last);
}

/** The decoded last path segment of an address. */
export function readFileName(address: string): string | undefined {
  try {
    const segments = new URL(address).pathname.split("/");
    const lastSegment = segments.at(-1) ?? "";
    return readNonBlank(decodeURIComponent(lastSegment));
  } catch {
    return undefined;
  }
}

export function readStringProperty(
  node: Element,
  name: string,
): string | undefined {
  const value = node.properties[name];
  return typeof value === "string" ? value : undefined;
}

/** An absolute https address; sanitize keeps a relative one, which is never Media. */
export function readHttpsProperty(
  node: Element,
  name: string,
): string | undefined {
  const value = readStringProperty(node, name);
  return value?.startsWith(HTTPS_PREFIX) === true ? value : undefined;
}

function isBreak(node: ElementContent): boolean {
  return node.type === "element" && node.tagName === "br";
}

function endsLine(node: ElementContent | undefined): boolean {
  if (node === undefined || isBreak(node)) {
    return true;
  }
  return node.type === "text" && LINE_END.test(node.value);
}

function startsLine(node: ElementContent | undefined): boolean {
  if (node === undefined || isBreak(node)) {
    return true;
  }
  return node.type === "text" && LINE_START.test(node.value);
}

/** Nothing but line breaks sits between the paragraph child at `index` and the lines around it. */
export function isAloneOnLine(paragraph: Element, index: number): boolean {
  const siblings = paragraph.children;
  const before = siblings[index - 1];
  return endsLine(before) && startsLine(siblings[index + 1]);
}
