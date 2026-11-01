// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ATTACHMENT_ASSET_URL } from "@web/test/attachments";
import { MediaFailedRow } from ".";
import { MediaFailedRowKinds } from "./types";

describe("MediaFailedRow wording", () => {
  it("reads the author's alt text when there is one", () => {
    render(
      <MediaFailedRow
        alt="Checkout page after"
        kind={MediaFailedRowKinds.IMAGE}
      />,
    );

    expect(screen.getByText("Checkout page after")).toBeTruthy();
    expect(screen.queryByText("Image could not load")).toBeNull();
  });

  it("tells a screen reader the alt-labelled image did not load", () => {
    render(<MediaFailedRow alt="Checkout" kind={MediaFailedRowKinds.IMAGE} />);

    expect(
      screen.getByRole("img", { name: "Image could not load" }),
    ).toBeTruthy();
  });

  it("falls back to the image wording for an empty or blank alt", () => {
    render(<MediaFailedRow alt="  " kind={MediaFailedRowKinds.IMAGE} />);

    expect(screen.getByText("Image could not load")).toBeTruthy();
  });

  it("uses the video wording for a video with no alt", () => {
    render(<MediaFailedRow kind={MediaFailedRowKinds.VIDEO} />);

    expect(screen.getByText("Video could not load")).toBeTruthy();
  });

  it("renders markup in the alt text as plain text", () => {
    const alt = '<b>bold</b><img src="https://example.com/x.png">';
    const { container } = render(
      <MediaFailedRow alt={alt} kind={MediaFailedRowKinds.IMAGE} />,
    );

    expect(screen.getByText(alt)).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("MediaFailedRow link", () => {
  it("opens a GitHub original in a new tab without opener or referrer", () => {
    render(
      <MediaFailedRow
        kind={MediaFailedRowKinds.IMAGE}
        originalAddress={ATTACHMENT_ASSET_URL}
      />,
    );

    const link = screen.getByRole("link", { name: /Open on GitHub/ });
    expect(link.getAttribute("href")).toBe(ATTACHMENT_ASSET_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("names the new tab in the link's accessible name", () => {
    render(
      <MediaFailedRow
        kind={MediaFailedRowKinds.IMAGE}
        originalAddress={ATTACHMENT_ASSET_URL}
      />,
    );

    expect(
      screen.getByRole("link", {
        name: /^Open on GitHub\s*\(opens in a new tab\)$/,
      }),
    ).toBeTruthy();
  });

  it("has no link for an image on an outside host", () => {
    render(
      <MediaFailedRow
        kind={MediaFailedRowKinds.IMAGE}
        originalAddress="https://example.com/a.png"
      />,
    );

    expect(screen.getByText("Image could not load")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("has no link without an original address", () => {
    render(<MediaFailedRow kind={MediaFailedRowKinds.IMAGE} />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});
