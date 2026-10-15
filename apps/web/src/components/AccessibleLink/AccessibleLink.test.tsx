// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccessibleLink } from ".";

describe("AccessibleLink", () => {
  it("renders a plain anchor with full passthrough and no rel default", () => {
    render(
      <AccessibleLink className="extra" data-testid="plain" href="/somewhere">
        Somewhere
      </AccessibleLink>,
    );
    const anchor = screen.getByTestId("plain");
    expect(anchor.getAttribute("href")).toBe("/somewhere");
    expect(anchor.className).toContain("extra");
    expect(anchor.hasAttribute("rel")).toBe(false);
  });

  it("target=_blank defaults rel=noreferrer and announces the new tab", () => {
    render(
      <AccessibleLink href="https://example.com" target="_blank">
        Example
      </AccessibleLink>,
    );
    const anchor = screen.getByRole("link", {
      name: /example.*opens in a new tab/i,
    });
    expect(anchor.getAttribute("rel")).toBe("noreferrer");
  });

  it("a caller rel wins over the _blank default", () => {
    render(
      <AccessibleLink
        href="https://example.com"
        rel="noreferrer noopener"
        target="_blank"
      >
        Example
      </AccessibleLink>,
    );
    expect(
      screen.getByRole("link", { name: /example/i }).getAttribute("rel"),
    ).toBe("noreferrer noopener");
  });
});
