import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
} from "@web/test/compiled-css";

const STEP_STYLESHEET = fileURLToPath(
  new URL("./StepButton.module.scss", import.meta.url),
);
const rules = parseCompiledRules(compileStylesheet(STEP_STYLESHEET));

describe("StepButton stylesheet", () => {
  it("dims the key cap with the label on a focused disabled step", () => {
    const cap = readDeclarations(
      rules,
      ".button[aria-disabled=true]:focus-visible .key",
    );

    expect(cap.get("opacity")).toBe("var(--opacity-disabled)");
  });
});
