import { describe, expect, it } from "vitest";

import { appendQuote, buildQuoteBlock } from "./quote";

describe("buildQuoteBlock", () => {
  it("prefixes every line and drops trailing whitespace", () => {
    expect(buildQuoteBlock("one\ntwo\n")).toBe("> one\n> two");
  });
});

describe("appendQuote", () => {
  it("becomes the whole draft when the draft is empty", () => {
    expect(appendQuote("", "> hi")).toBe("> hi\n\n");
  });

  it("appends after a blank line when the draft has text", () => {
    expect(appendQuote("typed already\n", "> hi")).toBe(
      "typed already\n\n> hi\n\n",
    );
  });
});
