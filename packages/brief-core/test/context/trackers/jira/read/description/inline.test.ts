import { describe, expect, it } from "vitest";
import {
  makeLeaf,
  makeNode,
  makeParagraph,
  makeText,
  renderBlocks,
} from "./helpers";

const ACCOUNT_ID = "000000:00000000-0000-0000-0000-000000000000";
/** 2026-11-13T00:00:00Z as Jira sends it: a string of milliseconds. */
const TIMESTAMP = "1794528000000";

function renderInline(...inline: unknown[]): string {
  return renderBlocks(makeParagraph(...inline));
}

describe("renderDescription marks", () => {
  it("wraps struck text in tildes", () => {
    expect(renderInline(makeText("gone", "strike"))).toBe("~~gone~~");
  });

  it("keeps code text without backticks", () => {
    expect(renderInline(makeText("run()", "code"))).toBe("run()");
  });

  it("keeps a link's text and drops its href", () => {
    const link = {
      type: "text",
      text: "the spec",
      marks: [{ type: "link", attrs: { href: "https://example.com/spec" } }],
    };
    expect(renderInline("see ", link)).toBe("see the spec");
  });

  it.each([
    "strong",
    "em",
    "underline",
    "subsup",
    "textColor",
    "backgroundColor",
    "annotation",
    "border",
    "alignment",
    "indentation",
    "fontSize",
    "breakout",
    "dataConsumer",
    "fragment",
    "sparkle",
  ])("keeps the text under a %s mark and drops the mark", (mark) => {
    expect(renderInline(makeText("kept", mark))).toBe("kept");
  });

  it("wraps struck text once whatever other marks it carries", () => {
    const text = makeText("old", "strong", "strike", "em");
    expect(renderInline(text)).toBe("~~old~~");
  });

  it.each([
    ["marks that are not a list", { type: "strike" }],
    ["a mark that is not an object", ["strike", 7, null]],
    ["a mark with no type", [{ attrs: { type: "strike" } }]],
  ])("keeps the text under %s", (_label, marks) => {
    expect(renderInline({ type: "text", text: "kept", marks })).toBe("kept");
  });

  it("writes nothing for a text node with no text", () => {
    expect(renderInline({ type: "text" }, { type: "text", text: 7 })).toBe("");
  });
});

describe("renderDescription inline nodes", () => {
  it("writes a mention as its text and never its account id", () => {
    const mention = makeLeaf("mention", { id: ACCOUNT_ID, text: "@Dana" });
    expect(renderInline("ask ", mention)).toBe("ask @Dana");
  });

  it.each([
    ["no text", { id: ACCOUNT_ID }],
    ["an empty text", { id: ACCOUNT_ID, text: "" }],
    ["a text that is not a string", { id: ACCOUNT_ID, text: { id: 1 } }],
  ])("writes a mention with %s as @user", (_label, attrs) => {
    expect(renderInline("ask ", makeLeaf("mention", attrs))).toBe("ask @user");
  });

  it("writes an emoji as its text", () => {
    const emoji = makeLeaf("emoji", { shortName: ":tada:", text: "🎉" });
    expect(renderInline(emoji)).toBe("🎉");
  });

  it("writes an emoji with no text as its short name", () => {
    expect(renderInline(makeLeaf("emoji", { shortName: ":acme:" }))).toBe(
      ":acme:",
    );
  });

  it("writes nothing for an emoji with neither", () => {
    expect(renderInline("a", makeLeaf("emoji", { id: "1f600" }), "b")).toBe(
      "ab",
    );
  });

  it("writes a date as its UTC day", () => {
    const date = makeLeaf("date", { timestamp: TIMESTAMP });
    expect(renderInline("due ", date)).toBe("due 2026-11-13");
  });

  it("writes the UTC day of a timestamp late in the day", () => {
    const lastMillisecond = String(Date.UTC(2026, 0, 31, 23, 59, 59, 999));
    const date = makeLeaf("date", { timestamp: lastMillisecond });
    expect(renderInline(date)).toBe("2026-01-31");
  });

  it.each([
    ["a word", "tomorrow"],
    ["an empty string", ""],
    ["a number", 1794528000000],
    ["a negative count", "-86400000"],
    ["a count past year 9999", "999999999999999"],
    ["more digits than a date holds", "9".repeat(40)],
    ["an object", { ms: 1 }],
    ["nothing", undefined],
  ])("writes nothing for a date whose timestamp is %s", (_label, timestamp) => {
    const date = makeLeaf("date", { timestamp });
    expect(renderInline("due ", date, ".")).toBe("due .");
  });

  it("writes a status as its text in square brackets", () => {
    const status = makeLeaf("status", { text: "In Progress", color: "blue" });
    expect(renderInline("now ", status)).toBe("now [In Progress]");
  });

  it("writes nothing for a status with no text", () => {
    expect(renderInline("now", makeLeaf("status", { color: "blue" }))).toBe(
      "now",
    );
  });

  it("writes an inline card as its URL", () => {
    const card = makeLeaf("inlineCard", { url: "https://example.com/doc" });
    expect(renderInline("see ", card)).toBe("see https://example.com/doc");
  });

  it("writes nothing for an inline card with no URL string", () => {
    const card = makeLeaf("inlineCard", { data: { "@type": "Document" } });
    expect(renderInline("see", card)).toBe("see");
  });

  it.each([
    ["its alt text", { type: "file", id: "1", alt: "plan.png" }, "plan.png"],
    [
      "its URL when external",
      { type: "external", url: "https://example.com/a.png" },
      "https://example.com/a.png",
    ],
  ])("marks inline media with %s", (_label, attrs, named) => {
    expect(renderInline("see ", makeLeaf("mediaInline", attrs))).toBe(
      `see [attachment: ${named}]`,
    );
  });

  it("marks inline media that names nothing as a bare attachment", () => {
    const media = makeLeaf("mediaInline", { type: "file", id: "1" });
    expect(renderInline("see ", media)).toBe("see [attachment]");
  });

  it("writes nothing for a placeholder", () => {
    const placeholder = makeLeaf("placeholder", { text: "Type something" });
    expect(renderInline("a", placeholder, "b")).toBe("ab");
  });

  it("writes an unknown inline node's text attribute in line", () => {
    const extension = makeLeaf("inlineExtension", { text: "macro text" });
    expect(renderInline("a ", extension, " b")).toBe("a macro text b");
  });

  it("writes an unknown inline node's children in line", () => {
    const wrapper = makeNode("hologram", [makeText("inner", "strike")]);
    expect(renderInline("a ", wrapper, " b")).toBe("a ~~inner~~ b");
  });

  it("writes a block found among inline nodes as its text in line", () => {
    const stray = makeParagraph("stray");
    expect(renderInline("a ", stray, " b")).toBe("a stray b");
  });
});
