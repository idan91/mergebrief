import { describe, expect, it } from "vitest";

import { DetailsSurfaces } from "./types";
import { isReplaceableByPreview, pickLeaveTarget } from "./utils";

describe("isReplaceableByPreview", () => {
  it("lets a preview open when nothing is open", () => {
    expect(
      isReplaceableByPreview(undefined, DetailsSurfaces.WARNINGS, false),
    ).toBe(true);
  });

  it("lets a preview replace another surface's preview", () => {
    expect(
      isReplaceableByPreview(
        DetailsSurfaces.FACTS,
        DetailsSurfaces.WARNINGS,
        false,
      ),
    ).toBe(true);
  });

  it("never replaces a pinned surface", () => {
    expect(
      isReplaceableByPreview(
        DetailsSurfaces.FACTS,
        DetailsSurfaces.WARNINGS,
        true,
      ),
    ).toBe(false);
  });

  it("leaves the surface already open under the pointer alone", () => {
    expect(
      isReplaceableByPreview(
        DetailsSurfaces.WARNINGS,
        DetailsSurfaces.WARNINGS,
        false,
      ),
    ).toBe(false);
  });
});

describe("pickLeaveTarget", () => {
  const { FACTS, WARNINGS } = DetailsSurfaces;

  it("hands a pointer leave over to the other hovered trigger", () => {
    expect(pickLeaveTarget(WARNINGS, FACTS, "hover")).toBe(FACTS);
    expect(pickLeaveTarget(WARNINGS, FACTS, "safe-polygon")).toBe(FACTS);
  });

  it("closes when the hover is on the same trigger or none", () => {
    expect(pickLeaveTarget(WARNINGS, WARNINGS, "hover")).toBeUndefined();
    expect(pickLeaveTarget(WARNINGS, undefined, "hover")).toBeUndefined();
  });

  it("only closes when focus moved out", () => {
    expect(pickLeaveTarget(WARNINGS, FACTS, "focus-out")).toBeUndefined();
    expect(pickLeaveTarget(WARNINGS, FACTS, undefined)).toBeUndefined();
  });
});
