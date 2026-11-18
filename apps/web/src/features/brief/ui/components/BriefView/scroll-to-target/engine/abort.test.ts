// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { armScrollAbort } from "./abort";

describe("armScrollAbort", () => {
  it("stops listening once the remover runs", () => {
    const cancel = vi.fn();
    const removeAbort = armScrollAbort(cancel);

    removeAbort();
    window.dispatchEvent(new Event("wheel"));
    window.dispatchEvent(new Event("keydown"));
    window.dispatchEvent(new Event("touchstart"));
    window.dispatchEvent(new Event("pointerdown"));

    expect(cancel).not.toHaveBeenCalled();
  });

  it("keeps the scroll through a press on steering chrome", () => {
    const cancel = vi.fn();
    const bar = document.createElement("div");
    bar.dataset["scrollSteering"] = "";
    const step = bar.appendChild(document.createElement("button"));
    document.body.append(bar);
    const removeAbort = armScrollAbort(cancel);

    step.dispatchEvent(new Event("touchstart", { bubbles: true }));
    step.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(cancel).not.toHaveBeenCalled();

    step.dispatchEvent(new Event("touchmove", { bubbles: true }));
    expect(cancel).toHaveBeenCalledOnce();
    removeAbort();
    bar.remove();
  });

  it("gives way to a wheel over steering chrome", () => {
    const cancel = vi.fn();
    const bar = document.createElement("div");
    bar.dataset["scrollSteering"] = "";
    document.body.append(bar);
    const removeAbort = armScrollAbort(cancel);

    bar.dispatchEvent(new Event("wheel", { bubbles: true }));

    expect(cancel).toHaveBeenCalledOnce();
    removeAbort();
    bar.remove();
  });

  it("gives way to a key pressed on a steering button", () => {
    const cancel = vi.fn();
    const bar = document.createElement("div");
    bar.dataset["scrollSteering"] = "";
    const step = bar.appendChild(document.createElement("button"));
    document.body.append(bar);
    const removeAbort = armScrollAbort(cancel);

    step.dispatchEvent(new Event("keydown", { bubbles: true }));

    expect(cancel).toHaveBeenCalledOnce();
    removeAbort();
    bar.remove();
  });

  it("gives way to a press anywhere else", () => {
    const cancel = vi.fn();
    const removeAbort = armScrollAbort(cancel);

    document.body.dispatchEvent(new Event("touchstart", { bubbles: true }));

    expect(cancel).toHaveBeenCalledOnce();
    removeAbort();
  });
});
