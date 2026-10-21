// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiffCodeText } from ".";
import { resolveSyntaxClass } from "./utils";

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

describe("DiffCodeText emphasis", () => {
  it("marks the emphasised run inside its token and keeps the text", () => {
    const tokens = [
      { text: "const", classId: 4 },
      { text: " label", classId: 0 },
    ];
    const view = render(
      <DiffCodeText
        content="const label"
        emphasis={[{ from: 6, to: 11 }]}
        tokens={tokens}
      />,
    );
    const mark = view.container.querySelector("mark");

    expect(view.container.textContent).toBe("const label");
    expect(mark?.textContent).toBe("label");
    expect(mark?.firstElementChild?.className).toContain("syn-text");
    expect(mark?.className).toContain("emphasis");
  });

  it("renders a folded run over three tokens as one mark", () => {
    const tokens = [
      { text: "a", classId: 0 },
      { text: "?.", classId: 10 },
      { text: "c", classId: 3 },
      { text: "()", classId: 10 },
    ];
    const view = render(
      <DiffCodeText
        content="a?.c()"
        emphasis={[{ from: 1, to: 4 }]}
        tokens={tokens}
      />,
    );
    const marks = view.container.querySelectorAll("mark");

    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("?.c");
    expect(marks[0]?.children).toHaveLength(2);
    expect(marks[0]?.children[1]?.className).toContain("syn-entity");
    expect(view.container.textContent).toBe("a?.c()");
  });

  it("splits a token around a run that starts inside it", () => {
    const tokens = [{ text: "'old value'", classId: 5 }];
    const view = render(
      <DiffCodeText
        content="'old value'"
        emphasis={[{ from: 1, to: 4 }]}
        tokens={tokens}
      />,
    );
    const spans = view.container.querySelectorAll("span");

    expect(spans).toHaveLength(3);
    expect(view.container.querySelector("mark")?.textContent).toBe("old");
    expect(view.container.textContent).toBe("'old value'");
  });

  it("marks a plain row without tokens", () => {
    const view = render(
      <DiffCodeText content="a = 1" emphasis={[{ from: 4, to: 5 }]} />,
    );

    expect(view.container.querySelectorAll("span")).toHaveLength(0);
    expect(view.container.querySelector("mark")?.textContent).toBe("1");
    expect(view.container.textContent).toBe("a = 1");
  });
});

describe("resolveSyntaxClass", () => {
  it("falls back to the text class for an unknown index", () => {
    expect(resolveSyntaxClass(999)).toBe("syn-text");
  });
});
