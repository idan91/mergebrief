// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SYNTAX_PALETTE } from "@web/utils/diffTokens/palette";
import { DiffCodeText } from "./DiffCodeText";
import { resolveSyntaxClass } from "./utils";

afterEach(cleanup);

describe("DiffCodeText", () => {
  it("renders the raw content when the row has no tokens", () => {
    const view = render(<DiffCodeText content="const a = 1;" />);

    expect(view.container.querySelectorAll("span")).toHaveLength(0);
    expect(view.container.textContent).toBe("const a = 1;");
  });

  it("wraps every token in a span carrying its palette class", () => {
    const tokens = [
      { text: "const", classId: 4 },
      { text: " a", classId: 0 },
    ];
    const view = render(<DiffCodeText content="const a" tokens={tokens} />);
    const spans = view.container.querySelectorAll("span");

    expect(spans).toHaveLength(2);
    expect(spans[0]?.className).toContain("syn-keyword");
    expect(view.container.textContent).toBe("const a");
  });
});

describe("resolveSyntaxClass", () => {
  it("names a class for every palette entry", () => {
    SYNTAX_PALETTE.forEach((entry, index) => {
      expect(resolveSyntaxClass(index)).toBe(`syn-${entry.token}`);
    });
  });

  it("falls back to the text class for an unknown index", () => {
    expect(resolveSyntaxClass(999)).toBe("syn-text");
  });
});
