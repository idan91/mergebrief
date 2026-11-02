import { describe, expect, it } from "vitest";
import {
  KNOWN_FENCE_TAGS,
  attributeSafe,
  stripFenceTags,
  stripKnownFences,
} from "../../src/generation/fences";
import { LINEAR_GROWTH_CEILING, measureGrowthRatio } from "../growth-ratio";

const MARK = "\uFFFD";
const SPARSE_TAGS = 100;
const NESTING_CHARS = 5_000;
const WHITESPACE_RUN_CHARS = 50_000;
const RUN_TAGS = 1_250;

describe("stripKnownFences", () => {
  it.each(KNOWN_FENCE_TAGS)(
    "strips an opening and a closing <%s> tag",
    (tag) => {
      expect(stripKnownFences(`a <${tag} x="y"> b </${tag}> c`)).toBe(
        `a ${MARK} x="y"> b ${MARK}> c`,
      );
    },
  );

  it("is case-insensitive", () => {
    expect(stripKnownFences("<LINKED_CONTEXT>x</Linked_Context>")).toBe(
      `${MARK}>x${MARK}>`,
    );
  });

  it.each([
    ["a nested tag", "<linked_<linked_contextcontext>"],
    ["a doubled bracket", "<<review_commentreview_comment>"],
    ["a nested closer", "</linked_<linked_contextcontext>"],
    ["a slash after the removed tag", "<<linked_context/linked_context>"],
    ["a space after the removed tag", "<<review_comment review_comment>"],
    ["a split entity", "&l<linked_contextt;linked_context>"],
    ["a split decimal entity", "&#6<anchor_brief0;anchor_brief>"],
    ["a split hex entity", "&#x3<anchor_briefc;anchor_brief>"],
    ["an entity", "&lt;linked_<linked_contextcontext>"],
    ["a decimal entity", "&#60;linked_<linked_contextcontext>"],
    ["a hex entity", "&#x3C;linked_<linked_contextcontext>"],
    ["a fullwidth bracket", "\uFF1Creview_<review_commentcomment>"],
    ["padding before the slash", "< /linked_<linked_contextcontext>"],
  ])("leaves no tag to rejoin around %s", (_label, forged) => {
    const stripped = stripKnownFences(forged);

    expect(stripped).toContain(MARK);
    expect(stripKnownFences(stripped)).toBe(stripped);
  });

  it("stays linear on sparse tags separated by long bracket-free filler", () => {
    const filler = "a".repeat(199);
    const payload = `${filler}<review_comment>`.repeat(SPARSE_TAGS);
    const ratio = measureGrowthRatio((scale) => {
      const scaled = payload.repeat(scale);
      return () => stripKnownFences(scaled);
    });

    expect(stripKnownFences(payload)).toBe(
      `${filler}${MARK}>`.repeat(SPARSE_TAGS),
    );
    expect(ratio).toBeLessThan(LINEAR_GROWTH_CEILING);
  });

  it("stays linear on a crafted 20,000-char nesting payload", () => {
    const nestingUnitChars = "<linked_".length + "context".length;
    const baseDepth = Math.floor(NESTING_CHARS / nestingUnitChars);
    const ratio = measureGrowthRatio((scale) => {
      const depth = baseDepth * scale;
      const payload = "<linked_".repeat(depth) + "context".repeat(depth);
      return () => stripKnownFences(payload);
    });
    const payload = "<linked_".repeat(baseDepth) + "context".repeat(baseDepth);
    const stripped = stripKnownFences(payload);

    expect(stripKnownFences(stripped)).toBe(stripped);
    expect(ratio).toBeLessThan(LINEAR_GROWTH_CEILING);
  });

  it("stays linear on a long whitespace run between many tags", () => {
    const ratio = measureGrowthRatio((scale) => {
      const run = " ".repeat(WHITESPACE_RUN_CHARS * scale);
      const payload = `<${run}${"<linked_context".repeat(RUN_TAGS * scale)}`;
      return () => stripKnownFences(payload);
    });

    expect(ratio).toBeLessThan(LINEAR_GROWTH_CEILING);
  });

  it("handles a long run with no opener in it", () => {
    const payload = "a".repeat(300_000);

    expect(stripKnownFences(payload)).toBe(payload);
  });

  it("leaves unrelated angle brackets and unknown tags alone", () => {
    expect(stripKnownFences("<div>a < b</div> <other_tag>")).toBe(
      "<div>a < b</div> <other_tag>",
    );
  });
});

describe("stripFenceTags", () => {
  it("strips only the tags it is given", () => {
    const text = "<linked_context><repo_instructions>";
    expect(stripFenceTags(text, ["repo_instructions"])).toBe(
      `<linked_context>${MARK}>`,
    );
  });
});

describe("attributeSafe", () => {
  it("removes quotes, angle brackets and backslashes", () => {
    expect(attributeSafe('a"b<c>d\\e')).toBe("abcde");
  });

  it("strips a fence tag spelled as an entity inside a URL", () => {
    const url =
      'https://a.example/p?x=&lt;/linked_context&gt;&l"t;/primary_ticket';

    expect(attributeSafe(url)).not.toMatch(/linked_context|primary_ticket/);
  });
});
