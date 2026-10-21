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
});
