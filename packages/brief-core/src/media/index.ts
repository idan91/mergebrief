// Media items in a pull request description, read off the sanitized tree of
// the one Markdown pipeline: nothing here reads the raw text. Runs in the
// browser and the worker.
import type { Element, Root } from "hast";

import { parseSanitizedMarkdown } from "../sanitized-markdown";
import { CAPTION_BLOCK_TAG_NAMES, HEADING_TAG_NAMES } from "./consts";
import {
  readDiagramItem,
  readImageItem,
  readLinkItem,
  readVideoItem,
  type MediaPlace,
} from "./logic/items";
import { readPastedAssetLineId } from "./logic/pasted-asset-line";
import { readNonBlank, readText } from "./logic/text";
import type { ExtractMediaOptions, MediaItem, MediaKey } from "./types";

export { buildMermaidMediaKey } from "./logic/keys";
export { readPastedAssetLineId } from "./logic/pasted-asset-line";
export {
  isProxiedMediaAddress,
  readProxiedMediaSource,
} from "./logic/proxied-address";
export { ProxiedMediaSourceKinds } from "./logic/proxied-address/types";
export {
  DiagramTypes,
  MediaKinds,
  type ExtractMediaOptions,
  type MediaItem,
} from "./types";

interface WalkScope {
  readonly insideLink: boolean;
  readonly tableHeaders?: readonly (string | undefined)[];
  readonly tableHeader?: string | undefined;
}

interface Extraction {
  readonly repoSlug: string;
  readonly items: MediaItem[];
  readonly keys: Set<MediaKey>;
  heading: string | undefined;
  previousBlockText: string;
}

interface ChildPosition {
  readonly parent: Root | Element;
  readonly index: number;
}

const DOCUMENT_SCOPE: WalkScope = { insideLink: false };

function readElementChildren(node: Element): Element[] {
  return node.children.filter(
    (child): child is Element => child.type === "element",
  );
}

function readFirstRow(section: Element | undefined): Element | undefined {
  return section === undefined ? undefined : readElementChildren(section)[0];
}

function isHeaderRow(row: Element): boolean {
  const cells = readElementChildren(row);
  return cells.length > 0 && cells.every((cell) => cell.tagName === "th");
}

/**
 * The table's head row: the first `thead` row, else a first body row of
 * `th` cells, which is how a raw HTML table without `thead` parses.
 */
function readHeadRow(table: Element): Element | undefined {
  const sections = readElementChildren(table);
  const head = sections.find((child) => child.tagName === "thead");
  if (head !== undefined) {
    return readFirstRow(head);
  }
  const firstRow = readFirstRow(sections[0]);
  if (firstRow === undefined || !isHeaderRow(firstRow)) {
    return undefined;
  }
  return firstRow;
}

/** The header cells' text of a table's head row, by column. */
function readTableHeaders(table: Element): (string | undefined)[] {
  const headRow = readHeadRow(table);
  const cells = headRow === undefined ? [] : readElementChildren(headRow);
  return cells.map((cell) => readNonBlank(readText(cell)));
}

function readTextBefore(position: ChildPosition, fallback: string): string {
  const siblings = position.parent.children.slice(0, position.index);
  const text = siblings.map(readText).join("");
  return readNonBlank(text) === undefined ? fallback : text;
}

function readItem(
  node: Element,
  position: ChildPosition,
  scope: WalkScope,
  extraction: Extraction,
): MediaItem | undefined {
  const place: MediaPlace = {
    repoSlug: extraction.repoSlug,
    heading: extraction.heading,
    tableHeader: scope.tableHeader,
  };
  switch (node.tagName) {
    case "img":
      return scope.insideLink ? undefined : readImageItem(node, place);
    case "video":
      return readVideoItem(node, place);
    case "pre":
      return readDiagramItem(node, place);
    case "a": {
      const { parent, index } = position;
      const pastedAssetLine =
        readPastedAssetLineId(parent, index) !== undefined;
      const textBefore = readTextBefore(position, extraction.previousBlockText);
      return readLinkItem(node, place, { textBefore, pastedAssetLine });
    }
    default:
      return undefined;
  }
}

function readChildScope(node: Element, scope: WalkScope): WalkScope {
  if (node.tagName === "a") {
    return { ...scope, insideLink: true };
  }
  if (node.tagName === "table") {
    return { ...scope, tableHeaders: readTableHeaders(node) };
  }
  return scope;
}

function recordBlock(node: Element, extraction: Extraction): void {
  if (!CAPTION_BLOCK_TAG_NAMES.has(node.tagName)) {
    return;
  }
  const text = readNonBlank(readText(node));
  if (HEADING_TAG_NAMES.has(node.tagName)) {
    extraction.heading = text;
  }
  if (text !== undefined) {
    extraction.previousBlockText = text;
  }
}

function walkChildren(
  parent: Root | Element,
  scope: WalkScope,
  extraction: Extraction,
): void {
  const isRow = parent.type === "element" && parent.tagName === "tr";
  let column = 0;
  parent.children.forEach((child, index) => {
    if (child.type !== "element") {
      return;
    }
    const cellScope = isRow
      ? { ...scope, tableHeader: scope.tableHeaders?.[column] }
      : scope;
    column += 1;
    walkElement(child, { parent, index }, cellScope, extraction);
  });
}

function walkElement(
  node: Element,
  position: ChildPosition,
  scope: WalkScope,
  extraction: Extraction,
): void {
  const item = readItem(node, position, scope, extraction);
  if (item !== undefined && !extraction.keys.has(item.key)) {
    extraction.keys.add(item.key);
    extraction.items.push(item);
  }

  walkChildren(node, readChildScope(node, scope), extraction);
  recordBlock(node, extraction);
}

/**
 * Every Media item in `description`, in document order, one per key at its
 * first place: images, videos the API proxy serves, pasted assets alone on
 * a line, links to an image or video file in `repoSlug`, and Mermaid fences.
 * An image inside a link (a badge) is not one.
 */
export function extractMedia(
  description: string,
  options: ExtractMediaOptions,
): MediaItem[] {
  const tree = parseSanitizedMarkdown(description);
  const extraction: Extraction = {
    repoSlug: options.repoSlug,
    items: [],
    keys: new Set(),
    heading: undefined,
    previousBlockText: "",
  };
  walkChildren(tree, DOCUMENT_SCOPE, extraction);
  return extraction.items;
}
