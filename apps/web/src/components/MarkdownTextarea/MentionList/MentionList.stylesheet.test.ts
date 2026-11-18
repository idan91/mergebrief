import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileStylesheet, parseCompiledRules } from "@web/test/compiled-css";

function readZIndex(stylesheet: string): number {
  const rules = parseCompiledRules(
    compileStylesheet(fileURLToPath(new URL(stylesheet, import.meta.url))),
  );
  const layered = rules.find((rule) => rule.declarations.has("z-index"));
  return Number(layered?.declarations.get("z-index"));
}

describe("MentionList stylesheet", () => {
  it("floats the list above a dialog's sticky footer", () => {
    const listLayer = readZIndex("./MentionList.module.scss");
    const footerLayer = readZIndex("../../Modal/Footer/Footer.module.scss");

    expect(listLayer).toBeGreaterThan(footerLayer);
  });
});
