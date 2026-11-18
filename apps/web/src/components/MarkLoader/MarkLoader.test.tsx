// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkLoader } from ".";
import { MARK_LOADER_BANDS } from "./consts";
import { MarkLoaderSizes, MarkLoaderTones } from "./types";

afterEach(cleanup);

describe("MarkLoader", () => {
  it("is decorative, so the status text beside it carries the meaning", () => {
    render(<MarkLoader testId="loader" tone={MarkLoaderTones.BRAND} />);

    const loader = screen.getByTestId("loader");
    expect(loader.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws one clipped copy of the mark per diagonal band", () => {
    render(<MarkLoader testId="loader" tone={MarkLoaderTones.MUTED} />);

    const bands = [...screen.getByTestId("loader").querySelectorAll("svg")];
    expect(bands.map((band) => band.getAttribute("data-band"))).toEqual([
      ...MARK_LOADER_BANDS,
    ]);
  });

  it.each([
    [MarkLoaderTones.BRAND, MarkLoaderSizes.LG],
    [MarkLoaderTones.MUTED, MarkLoaderSizes.SM],
  ])("carries the %s tone at the %s size", (tone, size) => {
    render(<MarkLoader size={size} testId="loader" tone={tone} />);

    const loader = screen.getByTestId("loader");
    expect(loader.getAttribute("data-tone")).toBe(tone);
    expect(loader.getAttribute("data-size")).toBe(size);
  });

  it("defaults to the small size", () => {
    render(<MarkLoader testId="loader" tone={MarkLoaderTones.MUTED} />);

    expect(screen.getByTestId("loader").getAttribute("data-size")).toBe("sm");
  });
});
