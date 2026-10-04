// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { focusMainContent } from "./utils";

describe("focusMainContent", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("moves focus to the main content when it exists", () => {
    document.body.innerHTML = '<main id="main-content" tabindex="-1"></main>';

    focusMainContent();

    expect(document.activeElement?.id).toBe("main-content");
  });

  it("does nothing without a main content element", () => {
    expect(() => focusMainContent()).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });
});
