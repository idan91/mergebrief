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

function readRules(): CompiledRule[] {
  return parseCompiledRules(compileStylesheet(ROW_STYLESHEET));
}

function readSelector(rule: CompiledRule): string {
  return rule.selectors.join(", ");
}

function hidesFromAssistiveTech(rule: CompiledRule): boolean {
  const display = rule.declarations.get("display");
  const visibility = rule.declarations.get("visibility");
  return display === "none" || visibility === "hidden";
}

describe("InboxRow lead slot", () => {
  it("swaps the mark for the checkbox at once under the keyboard cursor", () => {
    const cursor = readRules().find((rule) =>
      rule.selectors.includes(".row[data-cursor=true] .lead"),
    );

    expect(cursor?.selectors).toContain(".row[data-cursor=true] .state");
    expect(cursor?.declarations.get("transition")).toBe("none");
  });

  it("never takes the row checkbox out of the accessibility tree", () => {
    const hiding = readRules().filter(
      (rule) =>
        readSelector(rule).includes(".lead") && hidesFromAssistiveTech(rule),
    );

    expect(hiding.map(readSelector)).toEqual([]);
  });

  it("keeps the lead slot under a hovering pointer for its state callout", () => {
    const blocking = readRules().filter(
      (rule) =>
        rule.media !== TOUCH_MEDIA &&
        readSelector(rule).endsWith(".lead") &&
        rule.declarations.get("pointer-events") === "none",
    );

    expect(blocking.map(readSelector)).toEqual([]);
  });

  it("lets a tap on the hidden touch checkbox reach the row link", () => {
    const passing = readRules().filter(
      (rule) =>
        rule.media === TOUCH_MEDIA &&
        rule.declarations.get("pointer-events") === "none",
    );

    expect(passing.map(readSelector)).toEqual([".lead"]);
  });

  it("shows a tappable checkbox in every row while selecting", () => {
    const selecting = readRules().filter((rule) => {
      const selector = readSelector(rule);
      return (
        selector.includes("[data-selecting=true]") && selector.endsWith(".lead")
      );
    });
    const selector = selecting.map(readSelector).join();
    const outranksTouchLead =
      selector.startsWith(".row") && selector.endsWith(" .lead");

    expect(selecting).toHaveLength(1);
    expect(outranksTouchLead).toBe(true);
    expect(selecting[0]?.media).toBeUndefined();
    expect(selecting[0]?.declarations.get("opacity")).toBe("1");
    expect(selecting[0]?.declarations.get("pointer-events")).toBe("auto");
  });
});
