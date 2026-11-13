import { AdfNodeTypes } from "./types";

/** Nodes are read this many levels under the document and no deeper; a normal description stays under 20. */
export const MAX_NODE_DEPTH = 32;
/** Past this many levels the indent stops growing; the text is still written. */
export const MAX_INDENT_LEVELS = 8;
export const INDENT = "  ";

export const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set(
  Object.values(AdfNodeTypes),
);
/** Type names come from outside: one read keeps this many for its log line. */
export const MAX_UNKNOWN_TYPE_NAMES = 10;
/** And only a name shaped like a node type; any other is walked but never named. */
export const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
