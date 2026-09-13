import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SYNTAX_PALETTE } from "@web/utils/diffTokens/palette";

const TOKENS_FILE = fileURLToPath(new URL("./tokens.scss", import.meta.url));
const CLASSES_FILE = fileURLToPath(
  new URL(
    "../components/DiffRows/DiffCodeText/DiffCodeText.module.scss",
    import.meta.url,
  ),
);

describe("syntax tokens", () => {
  it("defines one --syn token per palette entry with its hex", async () => {
    const tokens = await readFile(TOKENS_FILE, "utf8");

    for (const entry of SYNTAX_PALETTE) {
      expect(tokens).toContain(`--syn-${entry.token}: ${entry.hex};`);
    }
    expect(tokens.match(/--syn-[a-z-]+:/g)).toHaveLength(SYNTAX_PALETTE.length);
  });

  it("names every palette token in the code text class list", async () => {
    const classes = await readFile(CLASSES_FILE, "utf8");
    const names = [...classes.matchAll(/\.syn-([a-z-]+) \{/g)].map(
      (match) => match[1],
    );

    expect(names).toEqual(SYNTAX_PALETTE.map((entry) => entry.token));
  });
});
