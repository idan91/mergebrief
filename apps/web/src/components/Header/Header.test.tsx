// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderInRouter } from "../../test/router";
import { Header } from ".";

describe("Header", () => {
  it("renders the lockup as a link to Home inside a banner", async () => {
    await renderInRouter(<Header />);

    const banner = screen.getByRole("banner");
    const wordmark = screen.getByRole("link", { name: "MergeBrief" });
    expect(banner.contains(wordmark)).toBe(true);
    expect(wordmark.getAttribute("href")).toBe("/");
  });

  it("names the lockup once and hides its mark and wordmark", async () => {
    await renderInRouter(<Header />);

    const lockup = screen.getByRole("link", { name: "MergeBrief" });
    const drawings = [...lockup.querySelectorAll("svg")];

    expect(drawings).toHaveLength(2);
    expect(
      drawings.every((svg) => svg.getAttribute("aria-hidden") === "true"),
    ).toBe(true);
  });

  it("puts the end slot after the lockup", async () => {
    await renderInRouter(
      <Header end={<span data-testid="end">Account</span>} />,
    );

    const wordmark = screen.getByRole("link", { name: "MergeBrief" });
    const account = screen.getByTestId("end");
    const order = wordmark.compareDocumentPosition(account);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
