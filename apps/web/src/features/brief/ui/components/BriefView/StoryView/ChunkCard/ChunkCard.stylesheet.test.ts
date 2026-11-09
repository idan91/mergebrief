import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileStylesheet, parseCompiledRules } from "@web/test/compiled-css";

const CARD_STYLESHEET = fileURLToPath(
  new URL("./ChunkCard.module.scss", import.meta.url),
);
const rules = parseCompiledRules(compileStylesheet(CARD_STYLESHEET));

describe("ChunkCard stylesheet", () => {
  it("shows the chunk tools while keyboard focus is in the head", () => {
    const reveal = rules.find((rule) =>
      rule.selectors.some(
        (selector) =>
          selector.includes(".head:has(:focus-visible)") &&
          selector.includes(".tools"),
      ),
    );

    expect(reveal?.declarations.get("opacity")).toBe("1");
  });
});
