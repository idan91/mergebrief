// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiffViews } from "@web/components/DiffRows/types";
import { SkeletonRows } from ".";
import { BAR_WIDTHS_PERCENT, MAX_SKELETON_ROWS } from "./utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "SkeletonRows.module.scss"),
  "utf8",
);
const SWEEPS_BEFORE_SCRIPT =
  /animation: shine-band \$shine-cycle linear var\(--shine-delay, 0ms\) infinite;/;
const REDUCED_MOTION_HIDES_SHINE =
  /@media \(prefers-reduced-motion: reduce\) \{\s*\.shine \{\s*display: none;/;

const FILL_WIDTHS = /\$bar-widths: ([\d, ]+);/;

const COUNTS = {
  rows: 4,
  hunkRows: 1,
  expandRows: 0,
  splitRows: 3,
  lineWidths: { counts: [4, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
};

describe("SkeletonRows", () => {
  it("marks itself busy and names the wait for a screen reader", () => {
    render(<SkeletonRows counts={COUNTS} view={DiffViews.UNIFIED} />);

    const skeleton = screen.getByTestId("skeleton-rows");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(skeleton.textContent).toBe("Loading the code for this chunk");
  });

  it("hides the bars from assistive tech and draws one per row", () => {
    render(<SkeletonRows counts={COUNTS} view={DiffViews.UNIFIED} />);

    const bars = screen.getByTestId("skeleton-rows").children[1];
    expect(bars?.getAttribute("aria-hidden")).toBe("true");
    expect(bars?.children).toHaveLength(4);
  });

  it("draws two bars per row in the split view", () => {
    render(<SkeletonRows counts={COUNTS} view={DiffViews.SPLIT} />);

    const rows = screen.getByTestId("skeleton-rows").children[1];
    expect(rows?.children).toHaveLength(3);
    expect(rows?.children[0]?.children).toHaveLength(4);
  });

  it("lays one hidden shine over the block, carrying the same rows", () => {
    render(<SkeletonRows counts={COUNTS} view={DiffViews.UNIFIED} />);

    const shine = screen.getByTestId("skeleton-shine");
    expect(shine.parentElement).toBe(screen.getByTestId("skeleton-rows"));
    expect(shine.getAttribute("aria-hidden")).toBe("true");
    expect(shine.children[0]?.children).toHaveLength(4);
  });

  it("sweeps from the first paint, before script sets a phase", () => {
    expect(STYLESHEET).toMatch(SWEEPS_BEFORE_SCRIPT);
  });

  it("drops the shine when the reader asks for reduced motion", () => {
    expect(STYLESHEET).toMatch(REDUCED_MOTION_HIDES_SHINE);
  });

  it("fills a capped card's well past its rows, on the shine too", () => {
    const counts = { ...COUNTS, rows: 5000 };
    render(<SkeletonRows counts={counts} view={DiffViews.UNIFIED} />);

    const rows = screen.getByTestId("skeleton-rows").children[1];
    const track = screen.getByTestId("skeleton-shine").children[0];
    expect(rows?.children).toHaveLength(MAX_SKELETON_ROWS + 1);
    expect(rows?.lastElementChild?.getAttribute("data-testid")).toBe(
      "skeleton-fill",
    );
    expect(track?.children).toHaveLength(MAX_SKELETON_ROWS + 1);
    expect(track?.lastElementChild?.getAttribute("data-testid")).toBe(
      "skeleton-fill",
    );
  });

  it("draws the fill's bars at the widths the rows cycle through", () => {
    const widths = FILL_WIDTHS.exec(STYLESHEET)?.[1]?.split(", ").map(Number);

    expect(widths).toEqual(BAR_WIDTHS_PERCENT);
  });

  it("mounts no shine when the reader asks for reduced motion", () => {
    stubReducedMotion(true);
    render(<SkeletonRows counts={COUNTS} view={DiffViews.UNIFIED} />);

    expect(screen.getByTestId("skeleton-rows")).toBeTruthy();
    expect(screen.queryByTestId("skeleton-shine")).toBeNull();
  });

  it("hydrates the server's shine, then drops it under reduced motion", async () => {
    stubReducedMotion(true);
    const element = <SkeletonRows counts={COUNTS} view={DiffViews.UNIFIED} />;
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.append(container);
    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, "error");

    await act(async () => {
      hydrateRoot(container, element, { onRecoverableError: recoverable });
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="skeleton-shine"]'),
    ).toBeNull();
    container.remove();
  });
});
