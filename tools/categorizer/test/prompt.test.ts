import { describe, expect, it } from "vitest";

import { buildDeltaSystemPrompt, buildSystemPrompt } from "../src/prompt";

describe("prompt role guidance", () => {
  it("does not classify types, context, or CSS as supporting by file kind alone", () => {
    const text = `${buildSystemPrompt()}\n${buildDeltaSystemPrompt()}`;

    expect(text).toContain("Type, context, and CSS/style files are not automatically supporting");
    expect(text).toContain("`carrier` when they define the changed contract, state model, or visual behavior");
  });
});

describe("prompt risk-attribute trio (ADR 0026)", () => {
  const prompts = [buildSystemPrompt(), buildDeltaSystemPrompt()];

  it("lists all three tokens with glosses in both prompts", () => {
    for (const text of prompts) {
      expect(text).toContain("- `new-dependency`:");
      expect(text).toContain("- `new-abstraction`:");
      expect(text).toContain("- `comment-contradicts-code`:");
    }
  });

  it("carries the firing discipline and riskNotes instruction in both prompts", () => {
    for (const text of prompts) {
      // never on relocations; never a version-only bump; cite both sides
      expect(text).toContain("version-only bump");
      expect(text.includes("never on relocated code") || text.includes("never on relocations")).toBe(true);
      expect(text).toContain("riskNotes");
      expect(text).toContain('comment says X (L12), code does Y (L15)');
    }
  });

  it("carries the removes-validation additive-chunk discipline in both prompts", () => {
    for (const text of prompts) {
      expect(text).toContain(
        "`removes-validation` fires only when the diff deletes or rewrites an existing check",
      );
    }
  });

  it("never mentions AI authorship (authorship-agnostic prompts)", () => {
    for (const text of prompts) {
      expect(text.toLowerCase()).not.toContain("ai-authored");
      expect(text.toLowerCase()).not.toContain("ai authorship");
    }
  });
});
