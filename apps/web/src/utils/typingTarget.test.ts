// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { isTypingTarget } from "./typingTarget";

describe("isTypingTarget", () => {
  it("is true inside a text field, never on a click control", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const button = document.createElement("button");

    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(checkbox)).toBe(false);
    expect(isTypingTarget(button)).toBeFalsy();
    expect(isTypingTarget(null)).toBe(false);
  });
});
