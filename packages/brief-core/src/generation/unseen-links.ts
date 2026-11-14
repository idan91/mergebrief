import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { removeModelAuthoredBlocks } from "./fences";

/** The parser drops a leading BOM without counting it, which would shift every offset. */
const LEADING_BOMS = /^\uFEFF+/u;

/** A destination that names its own host. Any other resolves against the page that shows it. */
const ABSOLUTE_DESTINATION = /^(?:https?:\/\/|mailto:)/iu;

/** A match inside a long run of one mark would otherwise rescan the run from every position in it. */
const MAX_CLOSING_MARKS = 8;

/** Closing punctuation, then what cannot continue a URL: white space, a bracket, a quote or the end. */
const URL_END = new RegExp(
  String.raw`[.,;:!?*_~]{0,${MAX_CLOSING_MARKS}}(?:$|[\s<>"'\x60)\]}|\\])`,
  "uy",
);

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
  /** The prompt as people wrote it, without the blocks an earlier call wrote. */
  readonly shown: string;
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
  if (
    node.type === "link" ||
    node.type === "image" ||
    node.type === "definition"
  ) {
    return node.url;
  }
  if (node.type === "linkReference" || node.type === "imageReference") {
    return definitions.get(node.identifier.toUpperCase());
  }
  return undefined;
}

/**
 * What no URL holds unescaped. An angle-bracket destination can: it would
 * carry the words the prompt shows after a URL to that URL's host.
 */
const NEVER_IN_URL = /[\s<>"\x60]/u;

/** Longer than any address a browser bar takes; a longer destination is never looked for. */
const MAX_DESTINATION_CHARS = 2048;

/** What a host or a mailbox could still be running through just before a match. */
const ADDRESS_CHAR = /[A-Za-z0-9.%+_@-]/u;

/**
 * Whether `shown` holds `url` whole: a longer URL that starts with it does
 * not count. An address with no scheme can also be the tail of a longer host
 * or mailbox, so `startsWhole` asks that nothing of one run into it. The
 * search resumes past each occurrence it refuses, never inside it: a URL
 * that overlaps itself would otherwise be compared again from every period,
 * and the skipped occurrences can only refuse more.
 */
function hasWholeUrl(shown: string, url: string, startsWhole = false): boolean {
  let at = shown.indexOf(url);
  while (at !== -1) {
    URL_END.lastIndex = at + url.length;
    const cutsAddress = startsWhole && ADDRESS_CHAR.test(shown.charAt(at - 1));
    const endsWhole = URL_END.test(shown);
    if (endsWhole && !cutsAddress) {
      return true;
    }
    at = shown.indexOf(url, at + url.length);
  }
  return false;
}

/**
 * A literal autolink renders its own text, plus the scheme `www.` and email
 * literals gain; judged by that text, not by offsets, which a leading BOM
 * shifts.
 */
function isSeen(node: Nodes, destination: string, shown: string): boolean {
  const namesItsHost = ABSOLUTE_DESTINATION.test(destination);
  const holdsTextAroundUrl = NEVER_IN_URL.test(destination);
  const outgrowsUrl = destination.length > MAX_DESTINATION_CHARS;
  if (!namesItsHost || holdsTextAroundUrl || outgrowsUrl) {
    return false;
  }
  if (hasWholeUrl(shown, destination)) {
    return true;
  }
  if (node.type !== "link") {
    return false;
  }
  const label = readText(node);
  const literal = [`http://${label}`, `mailto:${label}`].includes(destination);
  if (!literal) {
    return false;
  }
  return hasWholeUrl(shown, label, true);
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
  const unseen =
    destination !== undefined && !isSeen(node, destination, context.shown);
  if (unseen) {
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
 * Drops each link, image or reference definition whose destination people
 * never showed the model whole; a bracketed link keeps its label. A URL the
 * model made up can carry what it read out of the run. A definition goes
 * with its link because the web renders a summary in two halves, and a
 * reference resolves inside its own half. A kept label can itself render as
 * a link, so passes repeat; a field still holding one after the last pass
 * comes back empty.
 */
export function removeUnseenLinks(
  text: string,
  prompt: string,
): UnseenLinkRemoval {
  const shown = removeModelAuthoredBlocks(prompt);
  let current = text;
  let removedCount = 0;

  for (let pass = 0; ; pass += 1) {
    current = current.replace(LEADING_BOMS, "");
    const tree = parseMarkdown(current);
    const definitions = new Map<string, string>();
    collectDefinitionUrls(tree, definitions);
    const found: UnseenLinks = { splices: [], literals: [] };
    findUnseenLinks(tree, { text: current, shown, definitions }, found);

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
