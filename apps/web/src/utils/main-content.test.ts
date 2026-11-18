// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { isFocusLost } from "./main-content";

afterEach(() => {
  document.body.replaceChildren();
});

describe("isFocusLost", () => {
  it("reads focus on the body, or on nothing, as lost", () => {
    expect(isFocusLost(document.body)).toBe(true);
    expect(isFocusLost(null)).toBe(true);
  });

  it("reads focus on an element the page still holds as kept", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(isFocusLost(button)).toBe(false);
  });

  it("reads focus on an element the last page took with it as lost", () => {
    const button = document.createElement("button");

    expect(isFocusLost(button)).toBe(true);
  });
});
