/**
 * Invariants:
 * - the block is a list of typed entries; `notion` is the only type today
 * - `tokenEnv` is an env-var NAME; a pasted value refuses the file without
 *   being echoed
 * - unknown keys and unknown types are named through the key gate
 * - the failure carries the context-source message, not the generator's
 */
import { describe, expect, it } from "vitest";
import { validateContextSourcesBlock } from "../src/config/context-sources";

describe("validateContextSourcesBlock", () => {
  it("accepts an empty list and a notion entry with or without tokenEnv", () => {
    expect(validateContextSourcesBlock([])).toEqual({ ok: true, value: [] });
    expect(validateContextSourcesBlock([{ type: "notion" }])).toEqual({
      ok: true,
      value: [{ type: "notion" }],
    });
    expect(
      validateContextSourcesBlock([{ type: "notion", tokenEnv: "MY_VAR" }]),
    ).toEqual({ ok: true, value: [{ type: "notion", tokenEnv: "MY_VAR" }] });
  });

  it("refuses a second entry of the same type, naming the field", () => {
    const result = validateContextSourcesBlock([
      { type: "notion", tokenEnv: "NOTION_ONE" },
      { type: "notion", tokenEnv: "NOTION_TWO" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain(
      'contextSources.1."type": duplicate entry of type "notion"',
    );
  });

  it("refuses a non-list block", () => {
    const result = validateContextSourcesBlock({ type: "notion" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toBe("invalid context source configuration");
    expect(result.error.issues[0]).toMatch(/^contextSources: /);
  });

  it("names an unknown type with the vocabulary, redacting secret shapes", () => {
    const jira = validateContextSourcesBlock([{ type: "jira" }]);
    expect(jira.ok).toBe(false);
    if (jira.ok) {
      return;
    }
    expect(jira.error.issues.join("; ")).toContain(
      'unknown type (valid: notion); got "jira"',
    );

    const pasted = validateContextSourcesBlock([
      { type: "ntn_1234567890abcdef" },
    ]);
    expect(pasted.ok).toBe(false);
    if (pasted.ok) {
      return;
    }
    const text = pasted.error.issues.join("; ");
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("ntn_");
  });

  it("refuses a tokenEnv that is a value, not a NAME, without echoing it", () => {
    const result = validateContextSourcesBlock([
      { type: "notion", tokenEnv: "ntn_secret-with-dash" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("contextSources.0.");
    expect(text).toContain("environment variable NAME");
    expect(text).not.toContain("ntn_secret");
  });

  it("refuses a lowercase token pasted as tokenEnv, the realistic paste", () => {
    const result = validateContextSourcesBlock([
      { type: "notion", tokenEnv: "ntn_1234567890abcdef" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).not.toContain("ntn_");
  });

  it("refuses unknown entry keys through the key gate", () => {
    const result = validateContextSourcesBlock([
      { type: "notion", token: "x", ntn_abc123: "y" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain('"token"');
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("ntn_abc");
  });
});
