// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderInRouter } from "../../test/router";
import { Header } from ".";

afterEach(cleanup);

describe("Header", () => {
  it("renders the wordmark as a link to Home inside a banner", async () => {
    await renderInRouter(<Header />);

    const banner = screen.getByRole("banner");
    const wordmark = screen.getByRole("link", { name: "MergeBrief" });
    expect(banner.contains(wordmark)).toBe(true);
    expect(wordmark.getAttribute("href")).toBe("/");
  });

  it("puts the end slot after the wordmark", async () => {
    await renderInRouter(
      <Header end={<span data-testid="end">Account</span>} />,
    );

    const wordmark = screen.getByRole("link", { name: "MergeBrief" });
    const account = screen.getByTestId("end");
    const order = wordmark.compareDocumentPosition(account);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
