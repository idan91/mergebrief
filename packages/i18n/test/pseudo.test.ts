import { describe, expect, it } from "vitest";
import { PSEUDO_LOCALE, pseudoPostProcessor } from "../src/pseudo";

function run(value: string, translator: unknown): string {
  return pseudoPostProcessor.process(value, "key", {}, translator);
}

describe("pseudoPostProcessor", () => {
  it("accents and pads only when the pseudo locale is active", () => {
    const out = run("not found", { language: PSEUDO_LOCALE });
    expect(out).toBe("[ñóŧ fóúñð····]");
  });

  it("passes through for any other language", () => {
    expect(run("not found", { language: "en" })).toBe("not found");
  });

  it("tolerates a malformed translator", () => {
    expect(run("not found", undefined)).toBe("not found");
    expect(run("not found", { language: 7 })).toBe("not found");
  });

  it("leaves characters without an accent mapping intact", () => {
    const out = run("PR #42", { language: PSEUDO_LOCALE });
    expect(out).toContain("#42");
  });
});
