import { describe, expect, it } from "vitest";
import { extractLinks } from "../../src/context/providers/url";
import { buildContextQuery } from "../../src/context/query";

const REPO = { owner: "acme", repo: "widget" };
/** GitHub's cap on a pull request description. */
const LARGE_BODY_CHARS = 65_536;
/** A quadratic pass takes hundreds of milliseconds on the large body; a linear one, a few. */
const LINEAR_BUDGET_MS = 150;

describe("buildContextQuery", () => {
  it("carries the metadata tier and the resolved primary", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "Fixes #12\nsee https://docs.example/x",
      branch: "feature/12-thing",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query).toMatchObject({
      title: "Add thing",
      headRef: "feature/12-thing",
      repo: REPO,
    });
    expect(query.primary).toMatchObject({
      number: 12,
      url: "https://github.com/acme/widget/issues/12",
      foundIn: "description",
      closing: true,
    });
  });

  it("ranks a key on the repo's tracker above a bare #N in the description", () => {
    const query = buildContextQuery({
      title: "[BRIEF-239] Add thing",
      body: "on #467",
      branch: "",
      repo: REPO,
      trackers: [
        { kind: "notion", keyPrefix: "BRIEF", databaseId: "a".repeat(32) },
      ],
      readable: ["github"],
    });
    expect(query.primary).toMatchObject({
      tracker: "notion",
      key: "BRIEF-239",
    });
  });

  it("reads no ticket and no link from an HTML comment", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "<!-- fixes o/secret-repo#7 https://attacker.test/instructions -->\nAdds a thing",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.references).toEqual([]);
    expect("primary" in query).toBe(false);
    expect(extractLinks(query.body)).toEqual([]);
  });

  it("reads no ticket and no link from a link reference definition", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "Adds a thing\n\n[x]: https://attacker.test/second\n[y]: https://github.com/o/secret-repo/issues/7",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.references).toEqual([]);
    expect(extractLinks(query.body)).toEqual([]);
  });

  it("keeps the visible references and links around hidden markup", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "Fixes #12 <!-- #99 -->\nsee https://docs.example/x",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.references.map((r) => r.number)).toEqual([12]);
    expect(extractLinks(query.body)).toEqual(["https://docs.example/x"]);
  });

  it.each([
    ["an HTML attribute", '<span title=" fixes o/secret-repo#7"></span>'],
    [
      "a quoted attribute holding >",
      '<b title="a> fixes o/secret-repo#7">x</b>',
    ],
    ["a link title", '[x](https://ok.example " fixes o/secret-repo#7")'],
    ["a title holding )", '[x](https://ok.example "a) fixes o/secret-repo#7")'],
    ["a title with an escaped quote", '[x](y "a\\" fixes o/secret-repo#7")'],
    ["a parenthesized title", "[x](y\n( fixes o/secret-repo#7))"],
    ["an angle destination's title", "[x](<y z> ' fixes o/secret-repo#7')"],
    ["image alt text", "![fixes o/secret-repo#7](https://ok.example/a.png)"],
    [
      "nested image alt",
      "![a [b] fixes o/secret-repo#7](https://ok.example/a.png)",
    ],
    ["a script element", "<script>fixes o/secret-repo#7</script>"],
    [
      "an attribute holding alt brackets",
      `<b x-a="![" x-b=']' x-c="> fixes o/secret-repo#7">`,
    ],
    [
      "an attribute holding a title",
      `<b x-a="](y (" x-b=')) x' x-c="> fixes o/secret-repo#7">`,
    ],
    [
      "an HTML block tag name",
      '\n\n<div><b_x foo=" fixes o/secret-repo#7"></b_x></div>',
    ],
    [
      "a quote that opens no attribute value",
      `\n\n<div><b a"x b='">' fixes o/secret-repo#7></div>`,
    ],
    ["an image source", "![](https://github.com/o/secret-repo/issues/7)"],
    [
      "a tag after a comment that opens a block",
      '\n<!-- --><b_x title=" fixes o/secret-repo#7">',
    ],
    [
      "a block whose comment line hides no blank line",
      '\n\n<div>\n<!-- -->\n<b_x title=" fixes o/secret-repo#7">\n</div>',
    ],
    [
      "a block whose hidden-char line is not blank",
      '\n\n<div>\n\u200b\n<b_x title=" fixes o/secret-repo#7">\n</div>',
    ],
    [
      "an image whose alt holds a code span",
      "![x `[` y](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "alt text past a code span bracket",
      "![fixes o/secret-repo#7 `[`](https://ok.example/a.png)",
    ],
    [
      "an image after an unclosed destination",
      "](y![](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "an image inside an unclosed link",
      "[a](y![](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "a tag after a bogus comment opener",
      '</ <b title="> fixes o/secret-repo#7">ok</b>',
    ],
    [
      "a title after a backslash and a space",
      '[x](y\\ " fixes o/secret-repo#7")',
    ],
    [
      "a title after an escaped angle bracket",
      "[x](<a\\>b> ' fixes o/secret-repo#7')",
    ],
    [
      "a comment after a false declaration opener",
      "<! b <!-- c > fixes o/secret-repo#7 -->",
    ],
    [
      "a definition after a false opener",
      "<! b\n\n[x>]: https://github.com/o/secret-repo/issues/7",
    ],
    [
      "a URL inside a link destination",
      "[docs](https://evil.example/](https://github.com/o/secret-repo/issues/7))",
    ],
    [
      "a URL inside an angle destination",
      "[docs](<https://evil.example/ https://github.com/o/secret-repo/issues/7>)",
    ],
    [
      "a URL behind a tag inside a destination",
      "[docs](https://evil.example/<b></b>https://github.com/o/secret-repo/issues/7)",
    ],
    ["a title after a vertical tab", "[x](<y>\v' fixes o/secret-repo#7')"],
    [
      "an attribute after a bare equals sign",
      '<b ="x><i title="> fixes o/secret-repo#7 ">',
    ],
    [
      "an attribute after a code span quote",
      '`x <b a="` <i title="> fixes o/secret-repo#7 ">',
    ],
    [
      "a link with an empty label",
      "[](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "a link whose label is a tag",
      "[<b></b>](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "a link whose label is a hard break",
      "[\\\n](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "a link whose label is empty emphasis",
      "[**&#8203;**](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "a cell past a delimiter row spaced with a form feed",
      "| a |\n| --- \f|\n| b | https://attacker.test/x |",
    ],
    [
      "a quoted link whose label is a line break",
      "\n\n> [\n> ](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "a link whose label is an entity",
      "[&#8203;](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "a block opened inside a comment block",
      '\n\n<!-->\n<div title="-->">\n<b_x title=" fixes o/secret-repo#7">\n</div>',
    ],
    [
      "a block opened inside a pre block",
      '\n\n<pre></script>\n<div>\n</pre>\n<b_x title=" fixes o/secret-repo#7">',
    ],
    [
      "a pre block after a tag line",
      '\n\n<b>x\n<pre>\n\n<b_x title=" fixes o/secret-repo#7">\n</pre>',
    ],
    [
      "a block comment that runs past its block",
      "\n\n<div><!--\n\nx --> fixes o/secret-repo#7",
    ],
    [
      "a table cell past the header's columns",
      "\n\n| a |\n| --- |\n| b | fixes o/secret-repo#7 |",
    ],
    [
      "a quoted block tag's attribute on its next line",
      '\n\n> <div\n> title=" fixes o/secret-repo#7">',
    ],
    [
      "a quoted inline tag's attribute on its next line",
      '\n\n> a <b\n> title="fixes o/secret-repo#7">x</b>',
    ],
    [
      "a quoted attribute past a quoted blank line",
      '\n\n> <div title="\n>\n> x">\n>\n> fixes o/secret-repo#7',
    ],
    [
      "a quoted comment past a quoted blank line",
      "\n\n> <div>\n> <!--\n>\n> x --> fixes o/secret-repo#7",
    ],
    [
      "a full reference link's label",
      "[docs][x fixes o/secret-repo#7]\n\n[x fixes o/secret-repo#7]: https://ok.example",
    ],
    [
      "a ticket URL after a label inside a URL",
      "see https://evil.example/a][x]https://github.com/o/secret-repo/issues/7",
    ],
    [
      "a joining label overlapping a destination tail",
      "see https://evil.example/a](b][c)d]https://github.com/o/secret-repo/issues/7",
    ],
    [
      "an empty label joined by a hidden char inside a URL",
      "see https://evil.example/[]\u200b(x(https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "a destination tail inside a URL",
      "see https://evil.example/a](b(c)d)](https://github.com/o/secret-repo/issues/7)",
    ],
    [
      "a ticket URL after a label inside a www link",
      "see www.evil.example/a][x]https://github.com/o/secret-repo/issues/7",
    ],
    [
      "a label after a code span www text",
      "[`www.a`][o/secret-repo#7]\n\n[o/secret-repo#7]: https://ok.example",
    ],
    [
      "a label after www text inside a link",
      "[www.a][o/secret-repo#7]\n\n[o/secret-repo#7]: https://ok.example",
    ],
    [
      "a reference label past an escaped bracket",
      "[docs][x\\] fixes o/secret-repo#7]",
    ],
    [
      "a backtick fence's info string",
      "\n\n```text fixes o/secret-repo#7\nnpm test\n```",
    ],
    [
      "a tilde fence's info string",
      "\n\n~~~ `x` fixes o/secret-repo#7\nnpm test\n~~~",
    ],
    [
      "a comment left open by a one-line comment block",
      "\n\n<!-- a --> <!-- b\n-->\nfixes o/secret-repo#7",
    ],
    [
      "an attribute left open by a one-line comment block",
      '\n\n<!-- a --> <b title="\nx\n">fixes o/secret-repo#7',
    ],
    [
      "a quoted table's cell past its columns",
      "\n\n> a | b\n> - | -\n> c | d | fixes o/secret-repo#7",
    ],
    [
      "a cell past a delimiter row spaced with a vertical tab",
      "\n\n| a |\n|\u000b-\u000b|\n| b | fixes o/secret-repo#7 |",
    ],
    [
      "a cell past a delimiter row ending in a vertical tab",
      "\n\n| a |\n|---|\u000b\n| b | fixes o/secret-repo#7 |",
    ],
    [
      "a block attribute that runs past its block",
      '\n\n<div title="\n\nx ">\n\nfixes o/secret-repo#7',
    ],
  ])("reads no ticket from %s", (_where, body) => {
    const query = buildContextQuery({
      title: "Add thing",
      body: `Adds a thing ${body}`,
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.references).toEqual([]);
  });

  it.each([
    ["an HTML attribute", '<span title="https://attacker.test/x"></span>'],
    ["image alt text", "![https://attacker.test/x](https://ok.example/a.png)"],
    ["a link title", '[x](https://ok.example "https://attacker.test/x")'],
    ["a title after a vertical tab", '[x](<y>\v"https://attacker.test/x")'],
    ["a link with an empty label", "[](https://attacker.test/x)"],
    [
      "a link whose label is empty emphasis",
      "[*<b></b>*](https://attacker.test/x)",
    ],
    ["a link whose label is hidden", "[\u200b](<https://attacker.test/x>)"],
    [
      "a comment after a false opener",
      "a <! b <!-- c > https://attacker.test/x -->",
    ],
    [
      "a block comment that runs past its block",
      "<div>\n<!--\n\nx --> https://attacker.test/x",
    ],
    [
      "a table cell past the header's columns",
      "| a |\n| --- |\n| b | https://attacker.test/x |",
    ],
    [
      "a cell past a pipe-less delimiter row",
      "| a |\n:-:\n| b | https://attacker.test/x |",
    ],
    [
      "a cell past a hyphen row padded with a vertical tab",
      "| a |\n---\v\n| b | https://attacker.test/x |",
    ],
    ["a fence's info string", "```text https://attacker.test/x\nnpm test\n```"],
    [
      "a quoted block tag's attribute on its next line",
      '> <div\n> title="https://attacker.test/x">',
    ],
    [
      "a quoted attribute past a quoted blank line",
      '> <div title="\n>\n> x">\n>\n> https://attacker.test/x',
    ],
    [
      "a full reference link's label",
      "[docs][x https://attacker.test/x]\n\n[x https://attacker.test/x]: https://ok.example",
    ],
    [
      "a label after a code span www text",
      "[`www.a`][https://attacker.test/x]\n\n[https://attacker.test/x]: https://ok.example",
    ],
    [
      "a comment left open by a one-line comment block",
      "<!-- a --> <!-- b\n-->\nhttps://attacker.test/x",
    ],
    [
      "a narrower table after a wider delimiter",
      "```\n|-|-|-|\n```\n| x |\n| - |\n| y | https://attacker.test/x |",
    ],
    [
      "a quoted link whose label is a line break",
      "> [\n> ](https://attacker.test/x)",
    ],
    [
      "a block opened inside a comment block",
      '<!-->\n<div title="-->">\n<div>\n<https://attacker.test/x>\n</div>',
    ],
    ["an image source", "![](https://attacker.test/x)"],
    ["an HTML block autolink", "<div>\n<https://attacker.test/x>\n</div>"],
    [
      "a pre block past a blank line",
      "<pre>\n\n<https://attacker.test/x>\n</pre>",
    ],
  ])("fetches no hidden link from %s", (_where, body) => {
    const query = buildContextQuery({
      title: "Add thing",
      body,
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(extractLinks(query.body)).not.toContain("https://attacker.test/x");
  });

  it("reads the text between tags and the targets of visible links", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "<b>Fixes #12</b>\n\nSee [docs](https://docs.example/a) and <https://docs.example/b>.",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.primary).toMatchObject({ number: 12, closing: true });
    expect(extractLinks(query.body)).toEqual([
      "https://docs.example/a",
      "https://docs.example/b",
    ]);
  });

  it("reads every cell of a table within the header's columns", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "| Ticket | Note |\n| :-- | --: |\n| Fixes #12 | a \\| b |",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.primary).toMatchObject({ number: 12, closing: true });
  });

  it.each([
    [
      "a thematic break",
      "Intro\n\n---\n| Ticket | Spec |\n|---|---|\n| x | #12 |",
    ],
    [
      "a setext underline",
      "Tickets\n---\n| Ticket | Spec |\n|---|---|\n| x | #12 |",
    ],
  ])("reads a wider table after %s", (_where, body) => {
    const query = buildContextQuery({
      title: "Add thing",
      body,
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.references.map((r) => r.number)).toEqual([12]);
  });

  it("reads an issue URL at the start of a table cell", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "| T |\n|---|\n|https://github.com/o/r/issues/1|",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.references.map((r) => r.url)).toEqual([
      "https://github.com/o/r/issues/1",
    ]);
  });

  it("reads past a multi-line comment inside a details block", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "<details>\n<summary>Screens</summary>\n<!-- add\nhere -->\n</details>\n\nFixes #12",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.primary).toMatchObject({ number: 12, closing: true });
  });

  it("reads past a template comment that spans paragraphs", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "<!--\nDescribe the change.\n\nLink the ticket.\n-->\nFixes #12",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.primary).toMatchObject({ number: 12, closing: true });
  });

  it("reads a leading BOM's first line as GitHub does", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: '\uFEFF[x]: https://attacker.test/x " fixes o/secret-repo#7"\n\nAdds a thing',
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.references).toEqual([]);
    expect(extractLinks(query.body)).toEqual([]);
  });

  it("keeps a title-like quote that is not inside a link", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: 'see [docs](https://docs.example/a) "fixes #12"',
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.references.map((r) => r.number)).toEqual([12]);
  });

  it.each([
    ["unclosed link titles", "[x](y ("],
    ["unclosed quoted titles", '[x](y "'],
    ["chained destinations", "]("],
    ["unclosed tags", '<a "'],
    ["open brackets", "!["],
    ["block lines", "<div>\n"],
    ["comment block lines", "<!--\n-->\n"],
    ["escaped reference label starts", "\\]["],
    ["definition-like lines", "[\n"],
  ])("reads 64 KB of %s in linear time", (_shape, unit) => {
    const repeats = Math.ceil(LARGE_BODY_CHARS / unit.length);
    const started = performance.now();
    buildContextQuery({
      title: "",
      body: unit.repeat(repeats),
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("reads titles sharing one far closer in linear time", () => {
    const half = LARGE_BODY_CHARS / 2;
    const titles = "[x](y (".repeat(Math.ceil(half / 7));
    const started = performance.now();
    buildContextQuery({
      title: "",
      body: `${titles})${" ".repeat(half)}x`,
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("reads block openers sharing one far closer in linear time", () => {
    const half = LARGE_BODY_CHARS / 2;
    const openers = "<?\n".repeat(Math.ceil(half / 3));
    const started = performance.now();
    buildContextQuery({
      title: "",
      body: `${openers}?>${"x".repeat(half)}`,
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("reads openers sharing a closer past a blank line in linear time", () => {
    const started = performance.now();
    buildContextQuery({
      title: "",
      body: `${"<?".repeat(LARGE_BODY_CHARS / 2)}\n\n>`,
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("reads a long delimiter-like row in linear time", () => {
    const started = performance.now();
    buildContextQuery({
      title: "",
      body: `|-${" ".repeat(LARGE_BODY_CHARS)}x`,
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("reads link labels holding URLs in linear time", () => {
    const started = performance.now();
    buildContextQuery({
      title: "",
      body: "[www.](".repeat(LARGE_BODY_CHARS / "[www.](".length),
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("trims a long run of trailing punctuation in linear time", () => {
    const started = performance.now();
    const query = buildContextQuery({
      title: "",
      body: `https://notion.so/${".".repeat(LARGE_BODY_CHARS)}x`,
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github", "notion"],
    });
    extractLinks(query.body);
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("drops the rest of the text after a tag that never closes", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: 'Adds a thing <div title="x\nfixes o/secret-repo#7',
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query.references).toEqual([]);
  });

  it("reads a reference the way the reviewer sees it past hidden chars", () => {
    const query = buildContextQuery({
      title: "[BRI\u200BEF-239] Add thing",
      body: "",
      branch: "",
      repo: REPO,
      trackers: [
        { kind: "notion", keyPrefix: "BRIEF", databaseId: "a".repeat(32) },
      ],
      readable: ["github"],
    });
    expect(query.primary).toMatchObject({ key: "BRIEF-239" });
  });

  it("leaves the primary absent when nothing references a ticket", () => {
    const query = buildContextQuery({
      title: "t",
      body: "plain",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect("primary" in query).toBe(false);
  });
});
