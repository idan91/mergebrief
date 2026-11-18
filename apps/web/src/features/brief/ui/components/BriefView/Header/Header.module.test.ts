import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  type CompiledRule,
} from "@web/test/compiled-css";

const SRC_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const STYLES_DIR = join(SRC_ROOT, "styles");
const HEADER_STYLESHEET = fileURLToPath(
  new URL("./Header.module.scss", import.meta.url),
);
const TOKEN_STYLESHEET = join(STYLES_DIR, "tokens.scss");

const META_HEIGHT_DECLARATION = /--header-meta-h\s*:/;
const META_HEIGHT = "--header-meta-h";

function readRules(path: string): CompiledRule[] {
  return parseCompiledRules(compileStylesheet(path));
}

async function findMetaHeightStylesheets(): Promise<string[]> {
  const entries = await readdir(SRC_ROOT, { recursive: true });
  const stylesheets = entries.filter((entry) => entry.endsWith(".scss"));
  const declaring: string[] = [];
  for (const stylesheet of stylesheets) {
    const source = await readFile(join(SRC_ROOT, stylesheet), "utf8");
    if (META_HEIGHT_DECLARATION.test(source)) {
      declaring.push(stylesheet);
    }
  }

  return declaring;
}

describe("Header meta line", () => {
  it("holds the root meta height whatever its controls measure", () => {
    const metaLine = readRules(HEADER_STYLESHEET).find((rule) =>
      rule.selectors.includes(".metaLine"),
    );

    expect(metaLine?.declarations.get("block-size")).toMatch(
      /^calc\(var\(--header-meta-h\)/,
    );
  });

  it("declares the meta height on the root alone", async () => {
    const declaringSelectors = readRules(TOKEN_STYLESHEET)
      .filter((rule) => rule.declarations.has(META_HEIGHT))
      .flatMap((rule) => rule.selectors);

    expect(await findMetaHeightStylesheets()).toEqual([
      relative(SRC_ROOT, TOKEN_STYLESHEET),
    ]);
    expect(declaringSelectors).toEqual([":root"]);
  });
});
