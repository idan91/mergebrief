import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileStylesheet, parseCompiledRules } from "@web/test/compiled-css";

const rules = parseCompiledRules(
  compileStylesheet(
    fileURLToPath(
      new URL("./RiskAttrsDisclosure.module.scss", import.meta.url),
    ),
  ),
);

describe("RiskAttrsDisclosure stylesheet", () => {
  it("sizes only the anchored panel to its chips, never the sheet", () => {
    const sizedToContent = rules.filter(
      (rule) => rule.declarations.get("inline-size") === "max-content",
    );

    expect(sizedToContent.flatMap((rule) => rule.selectors)).toEqual([
      ".panel:not([data-sheet])",
    ]);
  });
});
