// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { armLandingAbort } from "./utils";

describe("armLandingAbort", () => {
  it("cancels on the user's own input", () => {
    const cancel = vi.fn();
    armLandingAbort(cancel);

    window.dispatchEvent(new Event("wheel"));

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on a pointer press the target keeps to itself", () => {
    const cancel = vi.fn();
    armLandingAbort(cancel);
    const control = document.createElement("button");
    control.addEventListener("pointerdown", (event) => event.stopPropagation());
    document.body.append(control);

    control.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    control.remove();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the remover runs", () => {
    const cancel = vi.fn();
    const removeAbort = armLandingAbort(cancel);

    removeAbort();
    window.dispatchEvent(new Event("wheel"));
    window.dispatchEvent(new Event("keydown"));
    window.dispatchEvent(new Event("touchstart"));
    window.dispatchEvent(new Event("pointerdown"));

    expect(cancel).not.toHaveBeenCalled();
  });
});
