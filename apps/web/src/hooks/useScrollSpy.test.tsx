// @vitest-environment jsdom
// The resetKey contract: positional ids (c1..cN) are char-identical across
// brief revisions, so the spy's effect key cannot rely on the id list alone —
// a brief switch replaces the DOM nodes while the ids stay the same, and
// without a resetKey the observer keeps reporting the OLD document's answer
// until the next scroll event.
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useScrollSpy } from "./useScrollSpy";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** A node `useScrollSpy` sees as crossing the reading line (top<=150<bottom). */
function mountCrossing(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  el.getBoundingClientRect = () => ({ top: 100, bottom: 300 }) as DOMRect;
  document.body.append(el);
  return el;
}

describe("useScrollSpy resetKey", () => {
  it("re-initialises when resetKey changes even though ids are identical", () => {
    const el = mountCrossing("c1");
    const { result, rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useScrollSpy(["c1"], undefined, resetKey),
      { initialProps: { resetKey: "brief-a" } },
    );
    expect(result.current).toBe("c1");

    // The brief switch: same id, new node, no longer crossing the line.
    el.remove();
    const replacement = document.createElement("div");
    replacement.id = "c1";
    replacement.getBoundingClientRect = () =>
      ({ top: 900, bottom: 1000 }) as DOMRect;
    document.body.append(replacement);

    // Identical id list, unchanged resetKey: the effect must NOT re-run, so
    // the stale answer survives (this is the hazard the resetKey exists for).
    rerender({ resetKey: "brief-a" });
    expect(result.current).toBe("c1");

    // New resetKey: re-initialise against the current document.
    rerender({ resetKey: "brief-b" });
    expect(result.current).toBeNull();
  });
});
