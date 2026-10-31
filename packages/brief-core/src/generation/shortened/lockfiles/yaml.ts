import {
  isMap,
  isNode,
  isScalar,
  parseAllDocuments,
  visit,
  type Document,
  type YAMLMap,
} from "yaml";
import type { Result } from "types/utils";
import { LockfileReadFailures, type LockfileReadFailure } from "./types";

/** What a YAML lockfile's writer emits, checked before the parser runs. */
export interface YamlLockfileShape {
  /** Most documents the writer emits in one file. */
  maxDocuments: number;
  /** Whether a top-level key is one the writer emits. */
  isTopKey: (key: string) => boolean;
  /** The top-level sections read into values; absent reads whole documents. */
  sections?: readonly string[];
}

const YAML_MERGE_KEY = "<<";
const LONE_CARRIAGE_RETURN = /\r(?!\n)/;
const TRAILING_CARRIAGE_RETURN = /\r$/;
/** The parser's memory and time grow with nodes, which grow with lines; real lockfiles run 33 to 38 bytes a line. */
const MAX_LINES = 500_000;
/** The longest line of 18 large public pnpm and berry lockfiles is 1013 characters. */
const MAX_LINE_CHARS = 8192;
/** pnpm writes one flow level (`{integrity: ...}`, `[x64]`), berry none. */
const MAX_FLOW_DEPTH = 1;
/** The most items in one flow collection of those 18 lockfiles is 8. */
const MAX_FLOW_ITEMS = 64;
const FLOW_OPENERS = "[{";
const FLOW_CLOSERS = "]}";
const FLOW_SEPARATOR = ",";
const SEQUENCE_ENTRY = "- ";
const KEY_SEPARATOR = ": ";
/** Anchor, alias and tag indicators: a node starting with one is never plain. */
const INDIRECTION_INDICATORS = "&*!";
const COMPLEX_KEY_INDICATOR = "?";
const DOCUMENT_MARKERS: ReadonlySet<string> = new Set(["---", "..."]);
const MARKERS_PER_DOCUMENT = 2;
const SINGLE_QUOTE = "'";
const DOUBLE_QUOTE = '"';
const ESCAPE = "\\";
const COMMENT = "#";

const UNPARSEABLE = LockfileReadFailures.UNPARSEABLE;
const AMBIGUOUS = LockfileReadFailures.AMBIGUOUS;

/** Where the quoted scalar opening at `start` closes, past its quote; -1 when the line ends first. */
function findQuoteEnd(line: string, start: number): number {
  const quote = line[start];
  for (let index = start + 1; index < line.length; index += 1) {
    const char = line[index];
    if (quote === DOUBLE_QUOTE && char === ESCAPE) {
      index += 1;
    } else if (char === quote && quote === SINGLE_QUOTE) {
      if (line[index + 1] !== SINGLE_QUOTE) {
        return index + 1;
      }
      index += 1;
    } else if (char === quote) {
      return index + 1;
    }
  }
  return -1;
}

/** Whether nothing but blanks or a comment follows `end`. */
function endsLine(line: string, end: number): boolean {
  const rest = line.slice(end).trimStart();
  return rest === "" || rest.startsWith(COMMENT);
}

/**
 * Whether the flow collection opening at `start` stays within what the
 * writers emit: closed on its own line, one level deep, a few items.
 */
function isWrittenFlow(line: string, start: number): boolean {
  let depth = 0;
  let items = 1;
  for (let index = start; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (char === SINGLE_QUOTE || char === DOUBLE_QUOTE) {
      const end = findQuoteEnd(line, index);
      if (end === -1) {
        return false;
      }
      index = end - 1;
    } else if (FLOW_OPENERS.includes(char)) {
      depth += 1;
      if (depth > MAX_FLOW_DEPTH) {
        return false;
      }
    } else if (FLOW_CLOSERS.includes(char)) {
      depth -= 1;
      if (depth === 0) {
        return endsLine(line, index + 1);
      }
    } else if (char === FLOW_SEPARATOR) {
      items += 1;
      if (items > MAX_FLOW_ITEMS) {
        return false;
      }
    }
  }
  return false;
}

/** Where a key's value starts in `content`, or nothing when the content holds no value after a key. */
function findValueStart(content: string): number | undefined {
  let keyEnd: number;
  if (content.startsWith(SINGLE_QUOTE) || content.startsWith(DOUBLE_QUOTE)) {
    keyEnd = findQuoteEnd(content, 0);
    if (keyEnd === -1 || content[keyEnd] !== ":") {
      return undefined;
    }
  } else {
    keyEnd = content.indexOf(KEY_SEPARATOR);
    if (keyEnd === -1) {
      return undefined;
    }
  }
  const valueStart = keyEnd + 1;
  const value = content.slice(valueStart);
  return valueStart + value.length - value.trimStart().length;
}

/** Why the node starting at `position` falls outside what the writers emit, or nothing. */
function checkNodeStart(
  line: string,
  position: number,
): LockfileReadFailure | undefined {
  const char = line[position];
  if (char === undefined) {
    return undefined;
  }
  if (INDIRECTION_INDICATORS.includes(char)) {
    return AMBIGUOUS;
  }
  const misshapenFlow =
    FLOW_OPENERS.includes(char) && !isWrittenFlow(line, position);
  const unparseable = char === COMPLEX_KEY_INDICATOR || misshapenFlow;
  return unparseable ? UNPARSEABLE : undefined;
}

/** Why one line's node falls outside what the writers emit, or nothing. */
function checkNode(line: string): LockfileReadFailure | undefined {
  let start = line.length - line.trimStart().length;
  while (line.startsWith(SEQUENCE_ENTRY, start)) {
    start += SEQUENCE_ENTRY.length;
  }
  const valueOffset = findValueStart(line.slice(start));
  const nodes =
    valueOffset === undefined ? [start] : [start, start + valueOffset];
  for (const position of nodes) {
    const failure = checkNodeStart(line, position);
    if (failure !== undefined) {
      return failure;
    }
  }
  return undefined;
}

/** The key a top-level line opens, unquoted; nothing for a line that opens none. */
function readTopKey(line: string): string | undefined {
  if (line.startsWith(DOUBLE_QUOTE) || line.startsWith(SINGLE_QUOTE)) {
    const end = findQuoteEnd(line, 0);
    const opensKey = end !== -1 && line[end] === ":";
    return opensKey ? line.slice(1, end - 1) : undefined;
  }
  const separator = line.endsWith(":")
    ? line.length - 1
    : line.indexOf(KEY_SEPARATOR);
  return separator === -1 ? undefined : line.slice(0, separator);
}

function checkTopLine(
  line: string,
  shape: YamlLockfileShape,
): LockfileReadFailure | undefined {
  const content = line !== "" && !line.startsWith(COMMENT);
  if (!content || line.startsWith(" ") || DOCUMENT_MARKERS.has(line)) {
    return undefined;
  }
  const key = readTopKey(line);
  const knownKey = key !== undefined && shape.isTopKey(key);
  return knownKey ? undefined : UNPARSEABLE;
}

/**
 * Why `text` falls outside what a pnpm or berry writer emits, found in one
 * pass before any parse: too many or too long lines, a top-level key the
 * writer never emits, a flow collection nested, long or spanning lines, or
 * an anchor, alias or tag. The parser holds every node in memory, so this
 * keeps the worst input that reaches it near the worst real lockfile.
 */
function checkShape(
  text: string,
  shape: YamlLockfileShape,
): LockfileReadFailure | undefined {
  // Each document opens with at most one `---` and closes with one `...`.
  const maxMarkers = shape.maxDocuments * MARKERS_PER_DOCUMENT;
  let markers = 0;
  let lines = 0;
  for (let start = 0; start <= text.length; lines += 1) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(start, end).replace(TRAILING_CARRIAGE_RETURN, "");
    if (lines >= MAX_LINES || line.length > MAX_LINE_CHARS) {
      return UNPARSEABLE;
    }
    markers += DOCUMENT_MARKERS.has(line) ? 1 : 0;
    if (markers > maxMarkers) {
      return UNPARSEABLE;
    }
    const failure = checkTopLine(line, shape) ?? checkNode(line);
    if (failure !== undefined) {
      return failure;
    }
    start = end + 1;
  }
  return undefined;
}

/** Whether a mapping repeats a key or keys by anything but a plain scalar. */
function holdsAmbiguousKeys(map: YAMLMap): boolean {
  const keys = new Set<string>();
  for (const pair of map.items) {
    if (!isScalar(pair.key)) {
      return true;
    }
    const key = String(pair.key.value);
    if (keys.has(key) || key === YAML_MERGE_KEY) {
      return true;
    }
    keys.add(key);
  }
  return false;
}

/**
 * Whether the document holds an alias, an anchor, an explicit tag, a merge
 * key or a repeated key. Duplicates are checked here with a set: the
 * parser's own `uniqueKeys` compares pairwise, quadratic on a large map.
 */
function holdsIndirection(doc: Document.Parsed): boolean {
  let found = false;
  visit(doc, {
    Alias() {
      found = true;
      return visit.BREAK;
    },
    Node(_key, node) {
      const marked = node.anchor !== undefined || node.tag !== undefined;
      const ambiguous = marked || (isMap(node) && holdsAmbiguousKeys(node));
      if (ambiguous) {
        found = true;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return found;
}

function readSections(
  doc: Document.Parsed,
  sections: readonly string[] | undefined,
): unknown {
  if (sections === undefined) {
    return doc.toJS();
  }
  const values = sections.map((key): [string, unknown] => {
    const section = doc.get(key, true);
    return [key, isNode(section) ? section.toJS(doc) : section];
  });
  return Object.fromEntries(values);
}

/**
 * The plain value of each document of a pnpm or yarn berry lockfile, every
 * scalar a string, or of its `sections` when the shape names them. The
 * text is checked against the writer's shape first; the parser then builds
 * every document whole, and only the sections are converted. Duplicate
 * keys, anchors, aliases, tags and merge keys read as ambiguous anywhere:
 * the package manager's own YAML reader could resolve them differently.
 */
export function readYamlLockfile(
  text: string,
  shape: YamlLockfileShape,
): Result<unknown[], LockfileReadFailure> {
  // js-yaml, which pnpm and yarn read with, breaks a line at a lone `\r`;
  // this parser does not, so a comment here could hide a line there.
  if (LONE_CARRIAGE_RETURN.test(text)) {
    return { ok: false, error: UNPARSEABLE };
  }
  const misshapen = checkShape(text, shape);
  if (misshapen !== undefined) {
    return { ok: false, error: misshapen };
  }

  const docs = parseAllDocuments(text, {
    schema: "failsafe",
    uniqueKeys: false,
    prettyErrors: false,
  });
  const parsed = Array.isArray(docs) ? docs : [];
  const malformed =
    parsed.length > shape.maxDocuments ||
    parsed.some((doc) => doc.errors.length > 0);
  if (malformed) {
    return { ok: false, error: UNPARSEABLE };
  }
  if (parsed.some(holdsIndirection)) {
    return { ok: false, error: AMBIGUOUS };
  }
  return {
    ok: true,
    value: parsed.map((doc) => readSections(doc, shape.sections)),
  };
}
