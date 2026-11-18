import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
} from "@web/test/compiled-css";

const FIELD_STYLESHEET = fileURLToPath(
  new URL("./MarkdownTextarea.module.scss", import.meta.url),
);
const rules = parseCompiledRules(compileStylesheet(FIELD_STYLESHEET));

describe("MarkdownTextarea stylesheet", () => {
  it("marks a focused field with an accent edge and the field glow", () => {
    const focused = readDeclarations(
      rules,
      ".field:has(.textarea:focus-visible)",
    );

    expect(focused.get("border-color")).toBe("var(--color-accent)");
    expect(focused.get("box-shadow")).toBe("var(--shadow-field-focus)");
  });

  it("rings a keyboard-focused field under increased contrast", () => {
    const ring = rules.find(
      (rule) =>
        rule.media?.includes("prefers-contrast: more") === true &&
        rule.selectors.some((selector) =>
          selector.includes(".field:has(.textarea:focus-visible)"),
        ),
    );

    expect(ring?.declarations.get("outline")).toMatch(/^2px solid/);
  });
});
