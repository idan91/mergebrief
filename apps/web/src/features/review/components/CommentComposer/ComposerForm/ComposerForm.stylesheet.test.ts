import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
} from "@web/test/compiled-css";

const FORM_STYLESHEET = fileURLToPath(
  new URL("./ComposerForm.module.scss", import.meta.url),
);
const rules = parseCompiledRules(compileStylesheet(FORM_STYLESHEET));

describe("ComposerForm stylesheet", () => {
  it("raises Start review on Surface 2 behind the 0.39 grey edge", () => {
    const submit = readDeclarations(rules, ".actions .submit");

    expect(submit.get("background")).toBe("var(--color-surface-2)");
    expect(submit.get("border-color")).toBe("var(--color-outline-3)");
    expect(submit.get("color")).toBe("var(--color-text-1)");
  });

  it("keeps the raised skin dimmed on a focused disabled submit", () => {
    const focused = readDeclarations(
      rules,
      ".actions .submit[aria-disabled=true]:focus-visible",
    );

    expect(focused.get("background")).toContain("var(--color-surface-2)");
    expect(focused.get("background")).toContain("var(--opacity-disabled)");
    expect(focused.get("border-color")).toContain("var(--color-outline-3)");
  });

  it("leaves the disabled look to Button's shared dim", () => {
    const restyled = rules.filter((rule) =>
      rule.selectors.some((selector) =>
        selector.endsWith("[aria-disabled=true]"),
      ),
    );

    expect(restyled).toEqual([]);
  });
});
