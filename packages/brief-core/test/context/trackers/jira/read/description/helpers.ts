import { renderDescription } from "../../../../../../src/context/trackers/jira/read/description";
import { MAX_SNIPPET_CHARS } from "../../../../../../src/context/types";

type Node = Record<string, unknown>;

export function makeNode(
  type: string,
  content?: readonly unknown[],
  attrs?: Record<string, unknown>,
): Node {
  const node: Node = { type };
  if (content !== undefined) {
    node["content"] = content;
  }
  if (attrs !== undefined) {
    node["attrs"] = attrs;
  }
  return node;
}

/** A node with attrs and no `content` key, as a leaf is sent. */
export function makeLeaf(type: string, attrs: Record<string, unknown>): Node {
  return makeNode(type, undefined, attrs);
}

export function makeText(text: string, ...markTypes: string[]): Node {
  const node: Node = { type: "text", text };
  if (markTypes.length > 0) {
    node["marks"] = markTypes.map((type) => ({ type }));
  }
  return node;
}

/** A paragraph; a string stands for a text node. */
export function makeParagraph(...inline: unknown[]): Node {
  const content = inline.map((item) =>
    typeof item === "string" ? makeText(item) : item,
  );
  return makeNode("paragraph", content);
}

/** A list item; a string stands for a paragraph. */
export function makeListItem(...children: unknown[]): Node {
  const content = children.map((child) =>
    typeof child === "string" ? makeParagraph(child) : child,
  );
  return makeNode("listItem", content);
}

export function makeBulletList(...items: unknown[]): Node {
  return makeNode("bulletList", items);
}

export function makeDoc(...blocks: unknown[]): Node {
  return { type: "doc", version: 1, content: blocks };
}

/** `bottom` wrapped in `count` nodes of `type`, outermost last, built without recursion. */
export function nestNode(
  type: string,
  count: number,
  bottom: unknown,
): unknown {
  let nested = bottom;
  for (let level = 0; level < count; level += 1) {
    nested = makeNode(type, [nested]);
  }
  return nested;
}

/** The text of a document holding `blocks`, under the snippet cap. */
export function renderBlocks(...blocks: unknown[]): string {
  return renderDescription(makeDoc(...blocks), MAX_SNIPPET_CHARS).text;
}

export function joinLines(...lines: string[]): string {
  return lines.join("\n");
}
