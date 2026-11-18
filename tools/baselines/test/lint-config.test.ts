// Severity, not presence: a rule named in the config but turned off is not
// configured, and removing its suppressions is a policy retirement.
import { describe, expect, it } from "vitest";
import { listConfiguredRules } from "../src/logic/lint-config";

const RULES = ["house/no-em-dash", "house/test-title"];

describe("listConfiguredRules", () => {
  it("counts a rule set to a real severity", () => {
    const text = `{ "rules": { "house/no-em-dash": "error" } }`;
    expect([...listConfiguredRules(text, RULES)]).toEqual(["house/no-em-dash"]);
  });

  it("does not count a rule set to off", () => {
    const text = `{ "rules": { "house/no-em-dash": "off" } }`;
    expect([...listConfiguredRules(text, RULES)]).toEqual([]);
  });

  it("does not count a rule set to severity zero", () => {
    const text = `{ "rules": { "house/no-em-dash": 0 } }`;
    expect([...listConfiguredRules(text, RULES)]).toEqual([]);
  });

  it("does not count a rule that survives only in a comment", () => {
    const text = `{
      // "house/no-em-dash": "error",
      "rules": { "house/test-title": "error" }
    }`;
    expect([...listConfiguredRules(text, RULES)]).toEqual(["house/test-title"]);
  });

  it("reads the severity out of a tuple", () => {
    const text = `{ "rules": { "house/no-em-dash": ["error", { "x": 1 }] } }`;
    expect([...listConfiguredRules(text, RULES)]).toEqual(["house/no-em-dash"]);
  });

  it("counts a rule turned on by an override", () => {
    const text = `{
      "rules": { "house/no-em-dash": "off" },
      "overrides": [{ "files": ["**/*.ts"], "rules": { "house/no-em-dash": "error" } }]
    }`;
    expect([...listConfiguredRules(text, RULES)]).toEqual(["house/no-em-dash"]);
  });

  it("keeps a rule name that appears inside a string value", () => {
    const text = `{ "rules": { "house/no-em-dash": "error" }, "note": "// not a comment" }`;
    expect([...listConfiguredRules(text, RULES)]).toEqual(["house/no-em-dash"]);
  });

  it("treats an unparseable config as proving nothing", () => {
    expect([...listConfiguredRules("{ not json", RULES)]).toEqual([]);
  });
});
