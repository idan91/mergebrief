// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderInRouter } from "../../test/router";
import { StatePage } from ".";

afterEach(cleanup);

describe("StatePage", () => {
  it("puts the one h1, the detail and the action in the main landmark", async () => {
    await renderInRouter(
      <StatePage
        action={<a href="/">Go</a>}
        detail="Nothing is here."
        heading="Gone"
        headerEnd={<span data-testid="header-end" />}
      />,
    );

    const main = screen.getByRole("main");
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(main.contains(headings[0] ?? null)).toBe(true);
    expect(headings[0]?.textContent).toBe("Gone");
    expect(main.textContent).toContain("Nothing is here.");
    const action = screen.getByRole("link", { name: "Go" });
    expect(main.contains(action)).toBe(true);
  });

  it("makes main the skip link's focusable target", async () => {
    await renderInRouter(
      <StatePage action={null} heading="Gone" headerEnd={null} />,
    );

    const main = screen.getByRole("main");
    expect(main.id).toBe("main-content");
    expect(main.tabIndex).toBe(-1);
  });

  it("renders the Header with its end slot above main", async () => {
    await renderInRouter(
      <StatePage
        action={null}
        heading="Gone"
        headerEnd={<span data-testid="header-end" />}
      />,
    );

    const banner = screen.getByRole("banner");
    const headerEnd = screen.getByTestId("header-end");
    expect(banner.contains(headerEnd)).toBe(true);
    const order = banner.compareDocumentPosition(screen.getByRole("main"));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
