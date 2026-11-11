import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type Declarations,
  parseColor,
  parseDeclarations,
  readTokenDeclarations,
  resolveTokenValue,
} from "./test-utils";

const DOCS_TOKENS_FILE = fileURLToPath(
  new URL("../../../docs-site/.vitepress/theme/tokens.css", import.meta.url),
);
const ROOT_BLOCK = /^:root \{([^}]*)\}/m;
const DARK_BLOCK = /^\.dark \{([^}]*)\}/m;

const RESTATED_COLOURS = [
  ["--mb-brand", "--color-brand"],
  ["--mb-brand-strong", "--color-brand-strong"],
  ["--mb-on-brand", "--color-on-brand"],
  ["--mb-ground", "--color-background"],
  ["--mb-surface-1", "--color-surface-1"],
  ["--mb-surface-2", "--color-surface-2"],
  ["--mb-surface-elevated", "--color-surface-3"],
  ["--mb-line", "--color-outline-1"],
  ["--mb-line-strong", "--color-outline-2"],
  ["--mb-text-1", "--color-text-1"],
  ["--mb-text-read", "--color-text-read"],
  ["--mb-text-2", "--color-text-2"],
  ["--mb-text-3", "--color-text-3"],
  ["--mb-accent", "--color-accent"],
  ["--mb-positive", "--color-positive"],
  ["--mb-warning", "--color-warning"],
  ["--mb-negative", "--color-negative"],
] as const;

const RESTATED_VALUES = [
  ["--mb-hue", "--theme-hue"],
  ["--mb-gray-c", "--gray-c"],
  ["--mb-shadow-float", "--shadow-float"],
] as const;

describe("docs-site tokens", () => {
  it.each(RESTATED_COLOURS)(
    "renders %s in the dark theme as %s",
    async (docsToken, webToken) => {
      const docs = await readDocsDarkDeclarations();
      const web = await readTokenDeclarations();
      const docsColour = parseColor(resolveTokenValue(docs, docsToken));
      const webColour = parseColor(resolveTokenValue(web, webToken));

      expect(docsColour).toEqual(webColour);
    },
  );

  it.each(RESTATED_VALUES)("restates %s as %s", async (docsToken, webToken) => {
    const docs = await readDocsDarkDeclarations();
    const web = await readTokenDeclarations();

    expect(resolveTokenValue(docs, docsToken)).toBe(
      resolveTokenValue(web, webToken),
    );
  });
});

/** The docs palette as the dark theme reads it: `:root`, then `.dark` over it. */
async function readDocsDarkDeclarations(): Promise<Declarations> {
  const source = await readFile(DOCS_TOKENS_FILE, "utf8");
  const root = ROOT_BLOCK.exec(source)?.[1];
  const dark = DARK_BLOCK.exec(source)?.[1];
  if (root === undefined || dark === undefined) {
    throw new Error("docs-site tokens.css lost its :root or .dark block");
  }

  return new Map([...parseDeclarations(root), ...parseDeclarations(dark)]);
}
