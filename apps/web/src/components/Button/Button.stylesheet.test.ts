import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
} from "@web/test/compiled-css";

const HOVER = "(hover: hover)";
const GHOSTS =
  ".button[data-variant=ghost], .button[data-variant=ghost-danger]";
const ENABLED_HOVER = ":not([aria-disabled=true]):hover";

const BUTTON_STYLESHEET = fileURLToPath(
  new URL("./Button.module.scss", import.meta.url),
);
const rules = parseCompiledRules(compileStylesheet(BUTTON_STYLESHEET));

describe("Button stylesheet ghost variants", () => {
  it("keeps a focused disabled ghost edgeless and its ink undimmed", () => {
    const focused = readDeclarations(
      rules,
      ".button[aria-disabled=true][data-variant=ghost]:focus-visible",
    );

    expect(focused.get("border-color")).toBe("transparent");
    expect(focused.has("color")).toBe(false);
  });

  it("rests with no edge or fill, in Text 2", () => {
    const ghost = readDeclarations(rules, GHOSTS);

    expect(ghost.get("border-color")).toBe("transparent");
    expect(ghost.get("color")).toBe("var(--color-text-2)");
    expect(ghost.get("font-weight")).toBe("500");
    expect(ghost.has("background")).toBe(false);
  });

  it("keeps the medium corner over the small size's", () => {
    const ghostIndex = rules.findIndex(
      (rule) => rule.selectors.join(", ") === GHOSTS,
    );
    const smallIndex = rules.findIndex(
      (rule) => rule.selectors.join(", ") === ".button[data-size=sm]",
    );

    expect(readDeclarations(rules, GHOSTS).get("border-radius")).toBe(
      "var(--radius-md)",
    );
    expect(ghostIndex).toBeGreaterThan(smallIndex);
  });

  it("steps to Surface 3 under the pointer", () => {
    const hover = readDeclarations(
      rules,
      `.button[data-variant=ghost]${ENABLED_HOVER}, .button[data-variant=ghost-danger]${ENABLED_HOVER}`,
      HOVER,
    );

    expect(hover.get("background")).toBe("var(--color-surface-3)");
    expect(hover.get("border-color")).toBe("transparent");
  });

  it("draws the danger ghost in negative ink with a negative tint", () => {
    const rest = readDeclarations(rules, ".button[data-variant=ghost-danger]");
    const hover = readDeclarations(
      rules,
      `.button[data-variant=ghost-danger]${ENABLED_HOVER}`,
      HOVER,
    );

    expect(rest.get("color")).toBe("var(--color-negative)");
    expect(hover.get("color")).toBe("var(--color-negative)");
    expect(hover.get("background")).toBe("var(--color-negative-tint-medium)");
  });
});
