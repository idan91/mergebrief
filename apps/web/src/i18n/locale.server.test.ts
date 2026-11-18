// Node environment on purpose (no jsdom pragma): the SSR pass has no
// window, and the guards below are what keep every server render on en.
import { describe, expect, it } from "vitest";
import { resolveInitialLocale } from "./locale";

describe("locale policy without a window during SSR", () => {
  it("resolves to en", () => {
    expect(resolveInitialLocale()).toBe("en");
  });
});
