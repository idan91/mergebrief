import { describe, expect, it } from "vitest";
import {
  KNOWN_FENCE_TAGS,
  attributeSafe,
  stripFenceTags,
  stripKnownFences,
} from "../../src/generation/fences";

describe("stripKnownFences", () => {
  it.each(KNOWN_FENCE_TAGS)(
    "strips an opening and a closing <%s> tag",
    (tag) => {
      expect(stripKnownFences(`a <${tag} x="y"> b </${tag}> c`)).toBe(
        `a  x="y"> b > c`,
      );
    },
  );

  it("is case-insensitive", () => {
    expect(stripKnownFences("<LINKED_CONTEXT>x</Linked_Context>")).toBe(">x>");
  });

  it("keeps stripping until no tag can form from the remainder", () => {
    expect(stripKnownFences("<linked_<linked_contextcontext>")).toBe(">");
    expect(stripKnownFences("<<review_commentreview_comment>")).toBe(">");
    expect(stripKnownFences("</linked_<linked_contextcontext>")).toBe(">");
    expect(
      stripKnownFences("<linked_".repeat(4) + "context".repeat(4) + "!"),
    ).toBe("!");
  });

  it("stays linear on sparse tags separated by long bracket-free filler", () => {
    const payload = ("a".repeat(199) + "<review_comment>").repeat(400);
    const started = performance.now();
    const stripped = stripKnownFences(payload);
    expect(performance.now() - started).toBeLessThan(200);
    expect(stripped).toBe(("a".repeat(199) + ">").repeat(400));
  });

  it("stays linear on a crafted 20,000-char nesting payload", () => {
    const depth = 20_000 / ("<linked_".length + "context".length);
    const payload = "<linked_".repeat(depth) + "context".repeat(depth);
    const started = performance.now();
    expect(stripKnownFences(payload)).toBe("");
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("collapses a tag formed across the removal boundary", () => {
    expect(stripKnownFences("<lin<linked_contextked_context")).toBe("");
    expect(stripKnownFences("<lin<linked_contextked_conte")).toBe(
      "<linked_conte",
    );
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
      "<linked_context>>",
    );
  });
});

describe("attributeSafe", () => {
  it("removes quotes, angle brackets and backslashes", () => {
    expect(attributeSafe('a"b<c>d\\e')).toBe("abcde");
  });
});
