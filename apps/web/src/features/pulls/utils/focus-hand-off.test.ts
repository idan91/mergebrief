// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { handOffFocusOnRemoval } from "./focus-hand-off";

function mountMain(): HTMLElement {
  const main = document.createElement("main");
  main.id = "main-content";
  main.tabIndex = -1;
  document.body.append(main);
  return main;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("handOffFocusOnRemoval", () => {
  it("moves focus held inside the element to the main landmark", () => {
    const main = mountMain();
    const notice = document.createElement("span");
    const button = document.createElement("button");
    notice.append(button);
    main.append(notice);
    button.focus();

    handOffFocusOnRemoval(notice)?.();

    expect(document.activeElement).toBe(main);
  });

  it("leaves focus the element never held where it is", () => {
    mountMain();
    const other = document.createElement("button");
    const button = document.createElement("button");
    document.body.append(other, button);
    other.focus();

    handOffFocusOnRemoval(button)?.();

    expect(document.activeElement).toBe(other);
  });

  it("returns no cleanup for a detached ref", () => {
    expect(handOffFocusOnRemoval(null)).toBeUndefined();
  });
});
