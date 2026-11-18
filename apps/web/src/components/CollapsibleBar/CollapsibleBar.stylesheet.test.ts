import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
} from "@web/test/compiled-css";

const GROUP_RADIUS = "var(--bar-group-radius)";

const BAR_STYLESHEET = fileURLToPath(
  new URL("./CollapsibleBar.module.scss", import.meta.url),
);
const rules = parseCompiledRules(compileStylesheet(BAR_STYLESHEET));

function listRoundedBottomSelectors(): string[] {
  return rules
    .filter((rule) => rule.declarations.has("border-end-start-radius"))
    .map((rule) => rule.selectors.join(", "));
}

describe("CollapsibleBar stylesheet", () => {
  it("rounds the first bar's head into the group's top corners", () => {
    const head = readDeclarations(rules, ".bar:first-child > .head");

    expect(head.get("border-start-start-radius")).toBe(GROUP_RADIUS);
    expect(head.get("border-start-end-radius")).toBe(GROUP_RADIUS);
  });

  it("rounds a closed last bar's head only when nothing sits under it", () => {
    const head = readDeclarations(
      rules,
      ".bar:last-child:not(:has(> .note)):has(> .panel[hidden]) > .head",
    );

    expect(head.get("border-end-start-radius")).toBe(GROUP_RADIUS);
    expect(head.get("border-end-end-radius")).toBe(GROUP_RADIUS);
    expect(listRoundedBottomSelectors()).toHaveLength(1);
  });

  it("fills the head alone under the pointer", () => {
    const hover = readDeclarations(
      rules,
      ".head:has(.toggle:hover)",
      "(hover: hover)",
    );

    expect(hover.get("background")).toBe("var(--color-surface-2)");
  });
});
