import { describe, expect, it } from "vitest";

import { buildDeltaSystemPrompt, buildSystemPrompt } from "../src/prompt.js";

describe("prompt role guidance", () => {
  it("does not classify types, context, or CSS as supporting by file kind alone", () => {
    const text = `${buildSystemPrompt()}\n${buildDeltaSystemPrompt()}`;

    expect(text).toContain("Type, context, and CSS/style files are not automatically supporting");
    expect(text).toContain("`carrier` when they define the changed contract, state model, or visual behavior");
  });
});
