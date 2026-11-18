import {
  KNOWN_NODE_TYPES,
  MAX_NODE_DEPTH,
  MAX_UNKNOWN_TYPE_NAMES,
  TYPE_NAME,
} from "./consts";
import { parseNode, type AdfNode } from "./schemas";

/** An attribute that holds text; undefined when it is missing, blank or not a string. */
export function readStringAttr(
  node: AdfNode,
  name: string,
): string | undefined {
  const value = node.attrs[name];
  const holdsText = typeof value === "string" && value.trim() !== "";
  return holdsText ? value : undefined;
}

/**
 * The nodes under `node`, which sits `depth` levels under the document, each
 * parsed only when the walk asks for it. Nothing is read past the depth
 * guard, so no walk goes deeper however deep the tree is.
 */
export function* readChildren(
  node: AdfNode,
  depth: number,
): Generator<AdfNode, void, undefined> {
  const isPastDepthGuard = depth >= MAX_NODE_DEPTH;
  if (node.content === undefined || isPastDepthGuard) {
    return;
  }
  for (const raw of node.content) {
    const child = parseNode(raw);
    if (child !== undefined) {
      yield child;
    }
  }
}

/** Keeps the name of a type the walk has no rule for, within the count and shape bounds. */
export function noteUnknownType(type: string, unknownTypes: Set<string>): void {
  if (KNOWN_NODE_TYPES.has(type)) {
    return;
  }
  const hasRoom = unknownTypes.size < MAX_UNKNOWN_TYPE_NAMES;
  const isPlainName = TYPE_NAME.test(type);
  if (hasRoom && isPlainName) {
    unknownTypes.add(type);
  }
}
