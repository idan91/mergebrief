import { describe, expect, it } from "vitest";
import { renderDescription } from "../../../../../../src/context/trackers/jira/read/description";
import { MAX_SNIPPET_CHARS } from "../../../../../../src/context/types";
import {
  joinLines,
  makeBulletList,
  makeDoc,
  makeLeaf,
  makeListItem,
  makeNode,
  makeParagraph,
  makeText,
  nestNode,
  renderBlocks,
} from "./helpers";

const FENCE = "```";
const HARD_BREAK = { type: "hardBreak" };
/** Deep enough to overflow the stack of a walk that recursed without a guard. */
const HOSTILE_DEPTH = 20_000;
/** Mirrors the walk's cap on unknown type names kept for the log line. */
const MAX_UNKNOWN_TYPE_NAMES = 10;

function makeTaskItem(state: string | undefined, ...content: unknown[]) {
  const attrs = state === undefined ? { localId: "t" } : { state };
  return makeNode("taskItem", content, attrs);
}

function makeCell(...blocks: unknown[]) {
  return makeNode("tableCell", blocks, {});
}

function makeTable(...rows: unknown[][]) {
  return makeNode(
    "table",
    rows.map((cells) => makeNode("tableRow", cells)),
  );
}

function makeCodeBlock(code: string, attrs?: Record<string, unknown>) {
  return makeNode("codeBlock", [{ type: "text", text: code }], attrs);
}

/** Bullet lists nested `levels` deep, one item per level naming its level. */
function nestBulletLists(levels: number) {
  let list: unknown;
  for (let level = levels; level >= 1; level -= 1) {
    const children = list === undefined ? [] : [list];
    list = makeBulletList(makeListItem(`level ${level}`, ...children));
  }
  return list;
}

describe("renderDescription paragraphs and headings", () => {
  it("writes one line per block in order", () => {
    const text = renderBlocks(makeParagraph("first"), makeParagraph("second"));
    expect(text).toBe("first\nsecond");
  });

  it.each([
    ["no content", makeNode("paragraph")],
    ["an empty content", makeParagraph()],
    ["only spaces", makeParagraph("   ")],
  ])("gives a paragraph with %s no line", (_label, paragraph) => {
    const text = renderBlocks(
      makeParagraph("a"),
      paragraph,
      makeParagraph("b"),
    );
    expect(text).toBe("a\nb");
  });

  it("drops the spaces a line ends on", () => {
    expect(renderBlocks(makeParagraph("  kept  "))).toBe("  kept");
  });

  it("breaks a paragraph at a hard break", () => {
    const paragraph = makeParagraph("one", HARD_BREAK, "two", HARD_BREAK);
    expect(renderBlocks(paragraph)).toBe("one\ntwo");
  });

  it.each([
    [1, "# Title"],
    [3, "### Title"],
    [6, "###### Title"],
  ])("writes a level %i heading under as many hashes", (level, line) => {
    const heading = makeNode("heading", [makeText("Title")], { level });
    expect(renderBlocks(heading)).toBe(line);
  });

  it.each([
    ["a level past six", 9, "###### Title"],
    ["a level under one", 0, "# Title"],
    ["a level that is not a whole number", "2", "# Title"],
  ])("clamps a heading with %s", (_label, level, line) => {
    const heading = makeNode("heading", [makeText("Title")], { level });
    expect(renderBlocks(heading)).toBe(line);
  });

  it("gives a heading with no text no line", () => {
    expect(renderBlocks(makeNode("heading", [], { level: 2 }))).toBe("");
  });
});

describe("renderDescription lists", () => {
  it("indents a nested list two spaces per level", () => {
    const nested = makeBulletList(makeListItem("child"));
    const list = makeBulletList(
      makeListItem("one", nested),
      makeListItem("two"),
    );
    expect(renderBlocks(list)).toBe(joinLines("- one", "  - child", "- two"));
  });

  it("numbers an ordered list from one by default", () => {
    const list = makeNode("orderedList", [
      makeListItem("first"),
      makeListItem("second"),
    ]);
    expect(renderBlocks(list)).toBe("1. first\n2. second");
  });

  it("numbers an ordered list from its start", () => {
    const items = [makeListItem("fifth"), makeListItem("sixth")];
    const list = makeNode("orderedList", items, { order: 5 });
    expect(renderBlocks(list)).toBe("5. fifth\n6. sixth");
  });

  it.each([
    ["a string", "7"],
    ["a fraction", 2.5],
    ["a negative number", -3],
    ["a number past the safe range", 1e21],
  ])("numbers from one when the start is %s", (_label, order) => {
    const list = makeNode("orderedList", [makeListItem("first")], { order });
    expect(renderBlocks(list)).toBe("1. first");
  });

  it("writes a list item's later children one level deeper", () => {
    const item = makeListItem(
      "lead",
      makeParagraph("more"),
      makeCodeBlock("x = 1"),
    );
    expect(renderBlocks(makeBulletList(item))).toBe(
      joinLines("- lead", "  more", `  ${FENCE}`, "  x = 1", `  ${FENCE}`),
    );
  });

  it("writes a bare marker for an item that opens on a block", () => {
    const item = makeListItem(makeCodeBlock("x = 1"));
    expect(renderBlocks(makeBulletList(item))).toBe(
      joinLines("-", `  ${FENCE}`, "  x = 1", `  ${FENCE}`),
    );
  });

  it("gives an item with no text and no other child no line", () => {
    const list = makeNode("orderedList", [
      makeListItem("first"),
      makeListItem(makeParagraph()),
      makeListItem("third"),
    ]);
    expect(renderBlocks(list)).toBe("1. first\n3. third");
  });

  it("keeps a hard break's next line at an indented item's indent", () => {
    const broken = makeListItem(makeParagraph("one", HARD_BREAK, "two"));
    const list = makeBulletList(makeListItem("top", makeBulletList(broken)));
    expect(renderBlocks(list)).toBe(joinLines("- top", "  - one", "  two"));
  });

  it("writes a list item found outside a list as a bullet", () => {
    expect(renderBlocks(makeListItem("stray"))).toBe("- stray");
  });

  it("writes a list's other children in place", () => {
    const list = makeBulletList(makeParagraph("loose"), makeListItem("item"));
    expect(renderBlocks(list)).toBe("loose\n- item");
  });

  it("stops growing the indent past eight levels", () => {
    const lines = renderBlocks(nestBulletLists(12)).split("\n");
    expect(lines).toEqual([
      "- level 1",
      "  - level 2",
      "    - level 3",
      "      - level 4",
      "        - level 5",
      "          - level 6",
      "            - level 7",
      "              - level 8",
      "                - level 9",
      "                - level 10",
      "                - level 11",
      "                - level 12",
    ]);
  });
});

describe("renderDescription tasks and decisions", () => {
  it("checks a done task and leaves any other open", () => {
    const list = makeNode("taskList", [
      makeTaskItem("DONE", makeText("shipped")),
      makeTaskItem("TODO", makeText("pending")),
      makeTaskItem(undefined, makeText("stateless")),
    ]);
    expect(renderBlocks(list)).toBe(
      joinLines("[x] shipped", "[ ] pending", "[ ] stateless"),
    );
  });

  it("sets a nested task list one level deeper", () => {
    const nested = makeNode("taskList", [
      makeTaskItem("DONE", makeText("child")),
    ]);
    const list = makeNode("taskList", [
      makeTaskItem("TODO", makeText("parent")),
      nested,
    ]);
    expect(renderBlocks(list)).toBe("[ ] parent\n  [x] child");
  });

  it("writes a block task item as its paragraph", () => {
    const item = makeNode("blockTaskItem", [makeParagraph("in a block")], {
      state: "DONE",
    });
    expect(renderBlocks(makeNode("taskList", [item]))).toBe("[x] in a block");
  });

  it("writes a decision as a bullet and drops its state", () => {
    const decision = makeNode("decisionItem", [makeText("Ship it")], {
      state: "DECIDED",
    });
    expect(renderBlocks(makeNode("decisionList", [decision]))).toBe(
      "- Ship it",
    );
  });
});

describe("renderDescription quotes, code and panels", () => {
  it("puts the quote mark in front of every child line", () => {
    const quote = makeNode("blockquote", [
      makeParagraph("one", HARD_BREAK, "two"),
      makeBulletList(makeListItem("item", makeParagraph("deeper"))),
    ]);
    expect(renderBlocks(quote)).toBe(
      joinLines("> one", "> two", "> - item", ">   deeper"),
    );
  });

  it("fences code under its language and keeps the lines as written", () => {
    const code = makeCodeBlock("if (a) {\n\n  b();\n}", { language: "ts" });
    expect(renderBlocks(code)).toBe(
      joinLines(`${FENCE}ts`, "if (a) {", "", "  b();", "}", FENCE),
    );
  });

  it("fences code with no language under a bare fence", () => {
    expect(renderBlocks(makeCodeBlock("plain"))).toBe(
      joinLines(FENCE, "plain", FENCE),
    );
  });

  it.each([
    ["holds a space", "ts extra"],
    ["holds a line break", "ts\ninjected"],
    ["holds a backtick", "ts`"],
    ["is not a string", { name: "ts" }],
  ])("leaves out a language that %s", (_label, language) => {
    expect(renderBlocks(makeCodeBlock("plain", { language }))).toBe(
      joinLines(FENCE, "plain", FENCE),
    );
  });

  it("keeps code text unmarked whatever marks it carries", () => {
    const code = makeNode("codeBlock", [makeText("a ~ b", "strike")]);
    expect(renderBlocks(code)).toBe(joinLines(FENCE, "a ~ b", FENCE));
  });

  it("writes a panel's children at its own depth and drops its type", () => {
    const panel = makeNode("panel", [makeParagraph("Careful.")], {
      panelType: "warning",
    });
    expect(renderBlocks(makeParagraph("a"), panel)).toBe("a\nCareful.");
  });

  it("gives a rule no line", () => {
    const text = renderBlocks(
      makeParagraph("a"),
      { type: "rule" },
      makeParagraph("b"),
    );
    expect(text).toBe("a\nb");
  });
});

describe("renderDescription tables", () => {
  it("writes a row as one line with its cells joined by a bar", () => {
    const header = [
      makeNode("tableHeader", [makeParagraph("Field")], {}),
      makeNode("tableHeader", [makeParagraph("Rule")], {}),
    ];
    const row = [
      makeCell(makeParagraph("email")),
      makeCell(makeParagraph("x")),
    ];
    expect(renderBlocks(makeTable(header, row))).toBe(
      "Field | Rule\nemail | x",
    );
  });

  it("flattens a cell's blocks to one line joined by a space", () => {
    const cell = makeCell(
      makeParagraph("first", HARD_BREAK, "second"),
      makeBulletList(makeListItem("item", makeParagraph("deeper"))),
    );
    const row = [cell, makeCell(makeParagraph("last"))];
    expect(renderBlocks(makeTable(row))).toBe(
      "first second - item deeper | last",
    );
  });

  it("keeps an empty cell's place in its row", () => {
    const row = [
      makeCell(makeParagraph("a")),
      makeCell(makeParagraph()),
      makeCell(makeParagraph("c")),
    ];
    expect(renderBlocks(makeTable(row))).toBe("a |  | c");
  });

  it("gives a row of empty cells no line", () => {
    const empty = [makeCell(makeParagraph()), makeCell()];
    const text = renderBlocks(makeTable(empty, [makeCell(makeParagraph("a"))]));
    expect(text).toBe("a");
  });

  it("ignores a cell's spans", () => {
    const wide = makeNode("tableCell", [makeParagraph("wide")], {
      colspan: 2,
      rowspan: 3,
    });
    expect(renderBlocks(makeTable([wide]))).toBe("wide");
  });

  it("keeps a row inside an indented block at that indent", () => {
    const cells = [makeCell(makeParagraph("a")), makeCell(makeParagraph("b"))];
    const table = makeTable(cells);
    const list = makeBulletList(makeListItem("lead", table));
    expect(renderBlocks(list)).toBe("- lead\n  a | b");
  });
});

describe("renderDescription expands, media and cards", () => {
  it.each(["expand", "nestedExpand"])(
    "writes an %s title then its children one level deeper",
    (type) => {
      const expand = makeNode(type, [makeParagraph("inside")], {
        title: "Details",
      });
      expect(renderBlocks(expand)).toBe("Details\n  inside");
    },
  );

  it.each([
    ["an empty title", { title: "" }],
    ["no title", {}],
    ["a title that is not a string", { title: { text: "x" } }],
  ])("gives an expand with %s no title line", (_label, attrs) => {
    const expand = makeNode("expand", [makeParagraph("inside")], attrs);
    expect(renderBlocks(expand)).toBe("  inside");
  });

  it("marks media by its alt text", () => {
    const media = makeLeaf("media", { type: "file", id: "1", alt: "plan.png" });
    expect(renderBlocks(makeNode("mediaSingle", [media]))).toBe(
      "[attachment: plan.png]",
    );
  });

  it("marks external media with no alt text by its URL", () => {
    const media = makeLeaf("media", {
      type: "external",
      url: "https://example.com/a.png",
    });
    expect(renderBlocks(makeNode("mediaSingle", [media]))).toBe(
      "[attachment: https://example.com/a.png]",
    );
  });

  it("marks a file with a URL and no alt text as a bare attachment", () => {
    const media = makeLeaf("media", {
      type: "file",
      id: "1",
      url: "https://example.com/a.png",
    });
    expect(renderBlocks(makeNode("mediaSingle", [media]))).toBe("[attachment]");
  });

  it("writes one marker per item of a media group", () => {
    const group = makeNode("mediaGroup", [
      makeLeaf("media", { type: "file", id: "1", alt: "a.pdf" }),
      makeLeaf("media", { type: "file", id: "2" }),
    ]);
    expect(renderBlocks(group)).toBe("[attachment: a.pdf]\n[attachment]");
  });

  it("writes a caption as a line after its media marker", () => {
    const single = makeNode("mediaSingle", [
      makeLeaf("media", { type: "file", id: "1", alt: "plan.png" }),
      makeNode("caption", [makeText("The plan")]),
    ]);
    expect(renderBlocks(single)).toBe("[attachment: plan.png]\nThe plan");
  });

  it.each(["blockCard", "embedCard"])("writes a %s as its URL", (type) => {
    const card = makeLeaf(type, { url: "https://example.com/doc" });
    expect(renderBlocks(card)).toBe("https://example.com/doc");
  });

  it("gives a card with no URL string no line", () => {
    const card = makeLeaf("blockCard", { data: { url: "https://x.test" } });
    expect(renderBlocks(makeParagraph("a"), card)).toBe("a");
  });

  it("writes nothing for a sync block, text attribute or not", () => {
    const block = makeLeaf("syncBlock", { resourceId: "r", text: "synced" });
    expect(renderBlocks(makeParagraph("a"), block)).toBe("a");
  });
});

describe("renderDescription unknown nodes", () => {
  it("skips anything that is not a node", () => {
    const text = renderBlocks(
      null,
      7,
      "text",
      [makeParagraph("in an array")],
      {},
      { type: 5, content: [makeParagraph("typeless")] },
      makeParagraph("kept"),
    );
    expect(text).toBe("kept");
  });

  it("walks an unknown node's children in place at the same depth", () => {
    const layout = makeNode("layoutSection", [
      makeNode("layoutColumn", [makeParagraph("left")]),
      makeNode("layoutColumn", [makeParagraph("right")]),
    ]);
    const list = makeBulletList(makeListItem("lead", layout));
    expect(renderBlocks(list)).toBe(joinLines("- lead", "  left", "  right"));
  });

  it("writes a childless unknown node's text attribute as a line", () => {
    const extension = makeLeaf("extension", {
      extensionKey: "macro",
      text: "Macro text",
    });
    expect(renderBlocks(makeParagraph("a"), extension)).toBe("a\nMacro text");
  });

  it("walks the children when an unknown node has both", () => {
    const bodied = makeNode("bodiedExtension", [makeParagraph("body")], {
      text: "fallback",
    });
    expect(renderBlocks(bodied)).toBe("body");
  });

  it("writes nothing for an unknown node with neither", () => {
    const frame = makeLeaf("extensionFrame", { parameters: { a: 1 } });
    expect(renderBlocks(makeParagraph("a"), frame)).toBe("a");
  });

  it("writes a node type that does not exist yet by the same rule", () => {
    const hologram = makeNode("hologram", [makeParagraph("projected")]);
    expect(renderBlocks(hologram)).toBe("projected");
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "treats a node typed %s as unknown",
    (type) => {
      const node = makeNode(type, [makeParagraph("inside")]);
      expect(renderBlocks(node)).toBe("inside");
    },
  );

  it("treats a content that is not a list as no content", () => {
    const text = renderBlocks(
      { type: "paragraph", content: "not a list" },
      { type: "panel", content: { 0: makeParagraph("keyed") } },
      { type: "extension", content: 7, attrs: { text: "from attrs" } },
    );
    expect(text).toBe("from attrs");
  });

  it("never prints an attribute that is not the text it expects", () => {
    const secret = { token: "s3cret", nested: ["s3cret"] };
    const text = renderBlocks(
      makeLeaf("extension", { text: secret, parameters: secret }),
      makeLeaf("hologram", { text: ["s3cret"] }),
      makeParagraph(
        makeLeaf("mention", { id: secret, text: secret }),
        makeLeaf("status", { text: secret }),
        makeLeaf("emoji", { text: secret, shortName: secret }),
        makeLeaf("inlineCard", { url: secret }),
        makeLeaf("mediaInline", { alt: secret, url: secret }),
      ),
      makeNode("expand", [], { title: secret }),
      makeLeaf("blockCard", { url: secret }),
      { type: "text", text: secret },
    );
    expect(text).toBe("@user[attachment]");
  });

  it("names each unknown type once in the order met", () => {
    const { unknownTypes } = renderDescription(
      makeDoc(
        makeNode("layoutSection", [makeNode("layoutColumn", [])]),
        makeParagraph(makeLeaf("inlineExtension", {}), makeText("known")),
        makeNode("layoutSection", []),
        makeNode("table", [makeNode("tableRow", [makeNode("tableCell", [])])]),
      ),
      MAX_SNIPPET_CHARS,
    );
    expect(unknownTypes).toEqual([
      "layoutSection",
      "layoutColumn",
      "inlineExtension",
    ]);
  });

  it("names no type for a block found among inline nodes", () => {
    const paragraph = makeParagraph(makeParagraph("stray"));
    const { unknownTypes } = renderDescription(
      makeDoc(paragraph),
      MAX_SNIPPET_CHARS,
    );
    expect(unknownTypes).toEqual([]);
  });

  it("keeps a bounded count of unknown type names", () => {
    const blocks = Array.from({ length: 30 }, (_, index) =>
      makeNode(`madeUp${index}`, []),
    );
    const { unknownTypes } = renderDescription(
      makeDoc(...blocks),
      MAX_SNIPPET_CHARS,
    );
    expect(unknownTypes).toHaveLength(MAX_UNKNOWN_TYPE_NAMES);
    expect(unknownTypes[0]).toBe("madeUp0");
  });

  it("keeps no unknown type name that is not a short plain word", () => {
    const { text, unknownTypes } = renderDescription(
      makeDoc(
        makeNode("x".repeat(200), [makeParagraph("long")]),
        makeNode("two words", [makeParagraph("spaced")]),
        makeNode("line\nbreak", [makeParagraph("broken")]),
        makeNode("", [makeParagraph("empty")]),
      ),
      MAX_SNIPPET_CHARS,
    );
    expect(text).toBe(joinLines("long", "spaced", "broken", "empty"));
    expect(unknownTypes).toEqual([]);
  });
});

describe("renderDescription depth and cap", () => {
  it("writes text thirty-two nodes down", () => {
    const quotes = nestNode("blockquote", 30, makeParagraph("bottom"));
    expect(renderBlocks(quotes)).toBe(`${"> ".repeat(30)}bottom`);
  });

  it("reads nothing below thirty-two nodes down", () => {
    const quotes = nestNode("blockquote", 31, makeParagraph("bottom"));
    expect(renderBlocks(makeParagraph("top"), quotes)).toBe("top");
  });

  it.each(["blockquote", "hologram", "bulletList", "tableRow"])(
    "survives %s nodes nested thousands deep",
    (type) => {
      const deep = nestNode(type, HOSTILE_DEPTH, makeParagraph("bottom"));
      expect(renderBlocks(makeParagraph("top"), deep)).toBe("top");
    },
  );

  it("survives inline nodes nested thousands deep", () => {
    const deep = nestNode("hologram", HOSTILE_DEPTH, makeText("bottom"));
    expect(renderBlocks(makeParagraph("top ", deep))).toBe("top");
  });

  it("cuts the text at the cap", () => {
    const blocks = Array.from({ length: 10 }, () => makeParagraph("12345"));
    const { text } = renderDescription(makeDoc(...blocks), 14);
    expect(text).toBe("12345\n12345\n12");
  });

  it("reads no node once it holds the cap", () => {
    let readsPastCap = 0;
    const watched = {
      get type() {
        readsPastCap += 1;
        return "paragraph";
      },
    };
    const doc = makeDoc(
      makeParagraph("12345"),
      makeParagraph("12345"),
      watched,
    );
    expect(renderDescription(doc, 10).text).toBe("12345\n1234");
    expect(readsPastCap).toBe(0);
  });

  it.each([
    ["list", "bulletList", makeListItem("12345")],
    ["task list", "taskList", makeNode("taskItem", [makeText("12345")])],
  ])("reads no %s item once it holds the cap", (_label, type, item) => {
    let readsPastCap = 0;
    const watched = {
      get type() {
        readsPastCap += 1;
        return "paragraph";
      },
    };
    const doc = makeDoc(makeNode(type, [item, item, watched]));
    expect(renderDescription(doc, 12).text).toHaveLength(12);
    expect(readsPastCap).toBe(0);
  });

  it("never ends the cut on half a surrogate pair", () => {
    const { text } = renderDescription(makeDoc(makeParagraph("ab😀")), 3);
    expect(text).toBe("ab");
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "{}"],
    ["a list", [makeParagraph("a")]],
  ])("reads a description that is %s as empty", (_label, tree) => {
    expect(renderDescription(tree, MAX_SNIPPET_CHARS)).toEqual({
      text: "",
      unknownTypes: [],
    });
  });

  it("writes nothing under a cap of zero", () => {
    expect(renderDescription(makeDoc(makeParagraph("a")), 0).text).toBe("");
  });
});
