import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { compileStylesheet, parseCompiledRules } from "../test/compiled-css";

const BASE_STYLESHEET = fileURLToPath(new URL("./base.scss", import.meta.url));
const ROW_STYLESHEET = fileURLToPath(
  new URL(
    "../features/inbox/components/InboxList/InboxRow/InboxRow.module.scss",
    import.meta.url,
  ),
);
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

describe("reduced motion", () => {
  it("keeps the opening row's notice delay", () => {
    const reducedRules = parseCompiledRules(
      compileStylesheet(BASE_STYLESHEET),
    ).filter((rule) => rule.media === REDUCED_MOTION);
    const openingRule = parseCompiledRules(
      compileStylesheet(ROW_STYLESHEET),
    ).find((rule) => rule.selectors.includes(".row[data-opening]"));

    expect(reducedRules.length).toBeGreaterThan(0);
    for (const rule of reducedRules) {
      expect(rule.declarations.has("transition-delay")).toBe(false);
    }
    expect(openingRule?.declarations.get("transition")).toContain(
      "var(--notice-delay)",
    );
  });
});
