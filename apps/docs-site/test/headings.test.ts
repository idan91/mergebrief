import { describe, expect, it } from "vitest";

import { readHeadings } from "../src/headings";

describe("readHeadings", () => {
  it("reads ATX headings as plain text with their depth", () => {
    const markdown =
      "# Self-host: the `mergebrief` CLI\n\ntext\n\n## See [compose](./compose.md) ##\n";

    expect(readHeadings(markdown)).toEqual([
      { depth: 1, text: "Self-host: the mergebrief CLI" },
      { depth: 2, text: "See compose" },
    ]);
  });

  it("skips lines inside backtick and tilde fences", () => {
    const markdown = [
      "```nginx",
      "# in the http {} block",
      "```",
      "~~~~",
      "# also code",
      "```",
      "# still code",
      "~~~~",
      "## Real",
    ].join("\n");

    expect(readHeadings(markdown)).toEqual([{ depth: 2, text: "Real" }]);
  });

  it("skips a leading frontmatter block", () => {
    const markdown =
      "---\ndate: 2026-10-31\n# yaml comment\n---\n\n## Highlights\n";

    expect(readHeadings(markdown)).toEqual([{ depth: 2, text: "Highlights" }]);
  });

  it("ignores a hash with no space and an indented code line", () => {
    expect(readHeadings("#hashtag\n    # indented code\n")).toEqual([]);
  });
});
