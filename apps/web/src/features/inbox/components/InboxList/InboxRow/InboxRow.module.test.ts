import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  type CompiledRule,
} from "@web/test/compiled-css";

const ROW_STYLESHEET = fileURLToPath(
  new URL("./InboxRow.module.scss", import.meta.url),
);
const TOUCH_MEDIA = "(hover: none)";

function readTouchRules(): CompiledRule[] {
  return parseCompiledRules(compileStylesheet(ROW_STYLESHEET)).filter(
    (rule) => rule.media === TOUCH_MEDIA,
  );
}

function readSelector(rule: CompiledRule): string {
  return rule.selectors.join(", ");
}

describe("InboxRow touch selection column", () => {
  it("keeps a focused row checkbox and its column while it holds focus", () => {
    const rules = readTouchRules();
    const hiding = rules.filter(
      (rule) => rule.declarations.get("display") === "none",
    );
    const collapsing = rules.filter((rule) =>
      rule.declarations.has("grid-template-columns"),
    );

    expect(hiding.map(readSelector)).toEqual([
      ".row:not([data-selecting=true]) .start:not(:focus-within)",
    ]);
    expect(collapsing.map(readSelector)).toEqual([
      ".row:not([data-selecting=true], :has(.start:focus-within))",
    ]);
  });
});
