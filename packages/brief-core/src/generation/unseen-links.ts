import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** The parser drops a leading BOM without counting it, which would shift every offset. */
const LEADING_BOMS = /^\uFEFF+/u;

/** Each pass shortens the text; past this many, a field still holding a link is dropped whole. */
const MAX_PASSES = 8;

export interface UnseenLinkRemoval {
  readonly text: string;
  readonly removedCount: number;
}

interface Splice {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/** What one pass found: offset splices, and the text of links the GFM transform built with no position. */
interface UnseenLinks {
  readonly splices: Splice[];
  readonly literals: string[];
}

interface LinkContext {
  readonly text: string;
  readonly prompt: string;
  readonly definitions: ReadonlyMap<string, string>;
}

/** The parse the web's renderer runs, so a link here is a link there. */
function parseMarkdown(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

/** Keyed and resolved as mdast-util-to-hast does: uppercase identifier, first definition wins. */
function collectDefinitionUrls(node: Nodes, urls: Map<string, string>): void {
  if (node.type === "definition") {
    const key = node.identifier.toUpperCase();
    if (!urls.has(key)) {
      urls.set(key, node.url);
    }
  }
  if ("children" in node) {
    for (const child of node.children) {
      collectDefinitionUrls(child, urls);
    }
  }
}

function readText(node: Nodes): string {
  if ("value" in node) {
    return node.value;
  }
  return "children" in node ? node.children.map(readText).join("") : "";
}

/** Where the node sends a reader, or nothing when it renders as no link. */
function readDestination(
  node: Nodes,
  definitions: ReadonlyMap<string, string>,
): string | undefined {
  if (node.type === "link" || node.type === "image") {
    return node.url;
  }
  if (node.type === "linkReference" || node.type === "imageReference") {
    return definitions.get(node.identifier.toUpperCase());
  }
  return undefined;
}

/**
 * A literal autolink renders its own text, plus the scheme `www.` and email
 * literals gain; judged by that text, not by offsets, which a leading BOM
 * shifts.
 */
function isSeen(node: Nodes, destination: string, prompt: string): boolean {
  if (prompt.includes(destination)) {
    return true;
  }
  if (node.type !== "link") {
    return false;
  }
  const shown = readText(node);
  const literal = [shown, `http://${shown}`, `mailto:${shown}`].includes(
    destination,
  );
  return literal && prompt.includes(shown);
}

/** A bracketed link keeps its label's source; an autolink or image goes whole. */
function buildSplice(text: string, node: Nodes): Splice | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    return undefined;
  }

  const children = "children" in node ? node.children : [];
  const labelStart = children.at(0)?.position?.start.offset;
  const labelEnd = children.at(-1)?.position?.end.offset;
  const bracketed = text.charAt(start) === "[";
  const keepsLabel =
    bracketed && labelStart !== undefined && labelEnd !== undefined;
  const replacement = keepsLabel ? text.slice(labelStart, labelEnd) : "";
  return { start, end, replacement };
}

function findUnseenLinks(
  node: Nodes,
  context: LinkContext,
  found: UnseenLinks,
): void {
  const destination = readDestination(node, context.definitions);
  if (destination !== undefined && !isSeen(node, destination, context.prompt)) {
    const splice = buildSplice(context.text, node);
    if (splice === undefined) {
      found.literals.push(readText(node));
    } else {
      found.splices.push(splice);
    }
    return;
  }
  if ("children" in node) {
    for (const child of node.children) {
      findUnseenLinks(child, context, found);
    }
  }
}

/** Splices from the end so earlier offsets hold; then each positionless link's text goes everywhere. */
function removeFound(text: string, found: UnseenLinks): string {
  let result = text;
  for (const splice of found.splices.toSorted((a, b) => b.start - a.start)) {
    result =
      result.slice(0, splice.start) +
      splice.replacement +
      result.slice(splice.end);
  }
  for (const literal of found.literals) {
    result = result.replaceAll(literal, "");
  }
  return result;
}

/**
 * Drops each link or image whose destination, as the renderer resolves it,
 * the prompt never showed; a bracketed link keeps its label. A URL the model
 * made up can carry what it read out of the run. A kept label can itself
 * render as a link, so passes repeat; a field still holding one after the
 * last pass comes back empty.
 */
export function removeUnseenLinks(
  text: string,
  prompt: string,
): UnseenLinkRemoval {
  let current = text;
  let removedCount = 0;

  for (let pass = 0; ; pass += 1) {
    current = current.replace(LEADING_BOMS, "");
    const tree = parseMarkdown(current);
    const definitions = new Map<string, string>();
    collectDefinitionUrls(tree, definitions);
    const found: UnseenLinks = { splices: [], literals: [] };
    findUnseenLinks(tree, { text: current, prompt, definitions }, found);

    const count = found.splices.length + found.literals.length;
    if (count === 0) {
      return { text: current, removedCount };
    }
    if (pass === MAX_PASSES) {
      return { text: "", removedCount: removedCount + count };
    }
    current = removeFound(current, found);
    removedCount += count;
  }
}

/** The warning for a field that lost links; the URLs stay out of it, since one may carry a secret. */
export function listUnseenLinkIssues(
  field: string,
  removal: UnseenLinkRemoval,
): string[] {
  if (removal.removedCount === 0) {
    return [];
  }
  return [
    `${field}: removed ${String(removal.removedCount)} link(s) the input never showed`,
  ];
}
