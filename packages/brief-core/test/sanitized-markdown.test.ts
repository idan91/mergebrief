import type { Element, Root, RootContent } from "hast";
import { describe, expect, it } from "vitest";
import { parseSanitizedMarkdown } from "../src/sanitized-markdown";

function collectTagNames(nodes: readonly (Root | RootContent)[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type !== "element" && node.type !== "root") {
      return [];
    }
    const own = node.type === "element" ? [node.tagName] : [];
    return [...own, ...collectTagNames(node.children)];
  });
}

function findElement(tree: Root, tagName: string): Element | undefined {
  const queue: (Root | RootContent)[] = [tree];
  for (const node of queue) {
    if (node.type === "element" && node.tagName === tagName) {
      return node;
    }
    if (node.type === "element" || node.type === "root") {
      queue.push(...node.children);
    }
  }
  return undefined;
}

describe("parseSanitizedMarkdown", () => {
  it("parses GFM tables into HTML nodes", () => {
    const tree = parseSanitizedMarkdown("| a |\n| - |\n| b |");

    expect(collectTagNames([tree])).toEqual(
      expect.arrayContaining(["table", "thead", "th", "tbody", "td"]),
    );
  });

  it("keeps a raw https img with its allowed attributes only", () => {
    const tree = parseSanitizedMarkdown(
      '<img src="https://x.test/a.png" alt="a" onerror="alert(1)" srcset="https://x.test/b.png 2x">',
    );

    expect(findElement(tree, "img")?.properties).toEqual({
      src: "https://x.test/a.png",
      alt: "a",
    });
  });

  it("drops a javascript: link target and strips script whole", () => {
    const tree = parseSanitizedMarkdown(
      "[x](javascript:alert(1))\n\n<script>alert(1)</script>",
    );

    expect(findElement(tree, "a")?.properties).toEqual({});
    expect(collectTagNames([tree])).not.toContain("script");
  });

  it("unwraps an element outside the allowlist and keeps its text", () => {
    const tree = parseSanitizedMarkdown(
      "<details><summary>More</summary>\n\nInside\n\n</details>",
    );

    expect(collectTagNames([tree])).not.toContain("details");
    expect(collectTagNames([tree])).toContain("p");
  });
});
