import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
} from "@web/test/compiled-css";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROGRESS_STYLESHEET = join(
  TEST_DIRECTORY,
  "ReadThroughProgress.module.scss",
);
const BASE_STYLESHEET = join(
  TEST_DIRECTORY,
  "../../../../../../styles/base.scss",
);
const PROGRESS_RULES = parseCompiledRules(
  compileStylesheet(PROGRESS_STYLESHEET),
);
const BASE_RULES = parseCompiledRules(compileStylesheet(BASE_STYLESHEET));
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const UNREAD_SHARE = "calc((1 - var(--fill)) * 100%)";

describe("ReadThroughProgress fill", () => {
  it("reveals a partial fill through a pill clip instead of a scale", () => {
    const fill = readDeclarations(PROGRESS_RULES, ".fill");
    const rtlFill = readDeclarations(PROGRESS_RULES, ".fill:dir(rtl)");

    expect(fill.has("transform")).toBe(false);
    expect(fill.get("clip-path")).toBe(
      `inset(0 ${UNREAD_SHARE} 0 0 round var(--radius-pill))`,
    );
    expect(rtlFill.get("clip-path")).toBe(
      `inset(0 0 0 ${UNREAD_SHARE} round var(--radius-pill))`,
    );
    expect(fill.get("transition")).toMatch(/^clip-path /);
  });

  it("keeps the clip out of the transitions reduced motion allows", () => {
    const reduced = readDeclarations(
      BASE_RULES,
      "*, *::before, *::after",
      REDUCED_MOTION,
    );

    expect(reduced.get("transition-property")).toBeDefined();
    expect(reduced.get("transition-property")).not.toMatch(/clip-path/);
  });
});
