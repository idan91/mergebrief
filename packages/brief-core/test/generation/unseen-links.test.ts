import { describe, expect, it } from "vitest";
import {
  listUnseenLinkIssues,
  removeUnseenLinks,
} from "../../src/generation/unseen-links";

const PROMPT = "PR: https://github.com/o/r/pull/1\nSee https://docs.example/a";

describe("removeUnseenLinks", () => {
  it("keeps the label of a Markdown link the prompt never showed", () => {
    const removal = removeUnseenLinks(
      "Read [the docs](https://evil.example/?q=TOKEN).",
      PROMPT,
    );

    expect(removal).toEqual({ text: "Read the docs.", removedCount: 1 });
  });

  it.each([
    ["a bare URL", "Leaks https://evil.example/x?k=v here", "Leaks  here"],
    ["an autolink", "Leaks <https://evil.example/x> here", "Leaks  here"],
    ["a www link", "Leaks www.evil.example/x. Done", "Leaks . Done"],
  ])("removes %s the prompt never showed", (_label, text, expected) => {
    expect(removeUnseenLinks(text, PROMPT).text).toBe(expected);
  });

  it.each([
    ["a seen URL with a tail", "x https://docs.example/a'ENV y", "x  y"],
    ["a spaced destination", "[d](<https://docs.example/a ENV>)", "d"],
    ["a parenthesised tail", "[d](https://docs.example/a()ENV)", "d"],
    ["a protocol-relative URL", "[d](//evil.example/?k=ENV)", "d"],
    ["a scheme with no slashes", "[d](http:evil.example/?k=ENV)", "d"],
    [
      "a reference link",
      "[d][r]\n\n[r]: //evil.example/?k=ENV",
      "d\n\n[r]: //evil.example/?k=ENV",
    ],
    ["a mail link", "<mailto:a@evil.example?body=ENV>", ""],
    ["an image", "![x](https://evil.example/p.png?k=ENV)", ""],
    ["a link after a BOM", "\uFEFF https://evil.example/S", " "],
    ["a www link after a BOM", "\uFEFFsee www.evil.example/E", "see "],
    ["a www link after a quote", '"www.evil.example/?k=ENV"', '""'],
    ["a www link after a colon", "see:www.evil.example/?k=ENV", "see:"],
    [
      "a reference whose first definition is unseen",
      "[d][r]\n\n[r]: https://evil.example/?k=ENV\n[r]: https://docs.example/a",
      "d\n\n[r]: https://evil.example/?k=ENV\n[r]: https://docs.example/a",
    ],
    [
      "a label that is itself a URL",
      "[https://evil.example/ENV](https://evil.example/ENV)",
      "",
    ],
  ])("removes %s left unseen", (_label, text, expected) => {
    expect(removeUnseenLinks(text, PROMPT).text).toBe(expected);
  });

  it("removes every unseen link from nested labels", () => {
    const nested =
      "[[[d](https://e.example/1)](https://e.example/2)](https://e.example/3)";

    expect(removeUnseenLinks(nested, PROMPT).text).not.toMatch(/e\.example/);
  });

  it("drops the whole field when a link cannot be cut out", () => {
    const encoded = '"www.evil.example/?a=1&amp;k=ENV"';

    expect(removeUnseenLinks(encoded, PROMPT).text).toBe("");
  });

  it("keeps links the prompt showed, trailing punctuation aside", () => {
    const text =
      "See [docs](https://docs.example/a) and https://github.com/o/r/pull/1.";

    expect(removeUnseenLinks(text, PROMPT)).toEqual({ text, removedCount: 0 });
  });
});

describe("removeUnseenLinks with a leading BOM", () => {
  it("checks the link the renderer shows, not a shifted span", () => {
    const planted = "desc https://evil.example/ here";
    const text = "\uFEFF https://evil.example/S https://evil.example/E";

    expect(removeUnseenLinks(text, planted).text).not.toMatch(/evil/);
  });
});

describe("listUnseenLinkIssues", () => {
  it("names the field and the count, never the URL", () => {
    const removal = removeUnseenLinks(
      "x https://evil.example/?q=TOKEN",
      PROMPT,
    );

    const issues = listUnseenLinkIssues("summary", removal);

    expect(issues).toEqual([
      "summary: removed 1 link(s) the input never showed",
    ]);
  });

  it("reports nothing when no link went", () => {
    expect(
      listUnseenLinkIssues("summary", { text: "", removedCount: 0 }),
    ).toEqual([]);
  });
});
