import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { describe, expect, it } from "vitest";

import { STICKY_STACK_HEIGHT_VAR } from "@web/utils/css-vars";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STYLES_DIRECTORY = join(TEST_DIRECTORY, "../../../../../styles");
const RULE = /([^{}]+)\{([^{}]*)\}/g;

/** Selectors of the compiled rules in `path` that declare the sticky-stack height. */
function readStackSelectors(path: string): string[] {
  const { css } = compile(path, { loadPaths: [STYLES_DIRECTORY] });
  const selectors: string[] = [];
  for (const [, selector = "", body = ""] of css.matchAll(RULE)) {
    if (body.includes(`${STICKY_STACK_HEIGHT_VAR}:`)) {
      selectors.push(selector.trim());
    }
  }
  return selectors;
}

describe("BriefView sticky-stack height", () => {
  it("is declared only while the Brief page's reading column renders", () => {
    const briefSelectors = readStackSelectors(
      join(TEST_DIRECTORY, "BriefView.module.scss"),
    );

    expect(briefSelectors).toEqual([":root:has(.readingColumn)"]);
  });

  it("has no root token, so other pages read the registered 0px", () => {
    const tokenSelectors = readStackSelectors(
      join(STYLES_DIRECTORY, "tokens.scss"),
    );

    expect(tokenSelectors).toEqual([]);
  });
});
