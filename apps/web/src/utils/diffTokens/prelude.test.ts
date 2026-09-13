import { describe, expect, it } from "vitest";

import { derivePrelude } from "./prelude";
import { GrammarNames } from "./types";

describe("derivePrelude", () => {
  it("opens a block comment when a closer precedes any opener", () => {
    const text = [
      "* the body of a JSDoc block",
      "*/",
      "export const a = 1;",
    ].join("\n");

    expect(derivePrelude(text, GrammarNames.TSX)).toBe("/*");
  });

  it("leaves balanced code alone", () => {
    const text = ["/* a whole comment */", "const a = `done`;"].join("\n");

    expect(derivePrelude(text, GrammarNames.TYPESCRIPT)).toBeUndefined();
  });

  it("opens a tag when the first line of a tsx side is an attribute", () => {
    const text = ["  onSelect={handleSelect}", '  label="Open"', "/>"].join(
      "\n",
    );

    expect(derivePrelude(text, GrammarNames.TSX)).toBe("<Prelude");
  });

  it("opens a tag for a jsx side whose first line is a lone slash close", () => {
    const text = ["  />", "</section>"].join("\n");

    expect(derivePrelude(text, GrammarNames.JSX)).toBe("<Prelude");
  });

  it("skips blank lines when picking the first line of a tsx side", () => {
    const text = ["", "   ", '  title="Files"', "/>"].join("\n");

    expect(derivePrelude(text, GrammarNames.TSX)).toBe("<Prelude");
  });

  it("leaves a tsx side opening inside an attribute value alone", () => {
    const text = ['    ? "a"', '    : "b"', "  }"].join("\n");

    expect(derivePrelude(text, GrammarNames.TSX)).toBeUndefined();
  });

  it("leaves a tsx side opening inside a call argument alone", () => {
    const text = ["  navigate({", '    to: "/briefs",', "  })"].join("\n");

    expect(derivePrelude(text, GrammarNames.TSX)).toBeUndefined();
  });

  it("never opens a tag for a grammar without JSX", () => {
    const text = ['  name="value"', "/>"].join("\n");

    expect(derivePrelude(text, GrammarNames.TYPESCRIPT)).toBeUndefined();
  });

  it("returns no prelude for an empty side", () => {
    expect(derivePrelude("", GrammarNames.TSX)).toBeUndefined();
  });
});
