// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COLLAPSE_TIMING, useCollapseMotion } from "./useCollapseMotion";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const TOKEN_STYLESHEET = join(
  TEST_DIRECTORY,
  "../../../../../../styles/tokens.scss",
);

function readTokenValue(tokens: string, name: string): string {
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1];

  return value?.trim() ?? "";
}

interface RecordedAnimation {
  target: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
}

interface HeaderParts {
  header: HTMLElement;
  identityRow: HTMLDivElement;
  metaLine: HTMLSpanElement;
  title: HTMLHeadingElement;
  titleGhost: HTMLSpanElement;
  neighbour: HTMLSpanElement;
  comparisonRow: HTMLDivElement;
  progressBar: HTMLDivElement;
}

type Box = Pick<DOMRect, "left" | "top" | "width" | "height" | "bottom">;

const REST_BOXES = {
  header: { left: 0, top: 0, width: 1440, height: 126, bottom: 126 },
  identityRow: { left: 0, top: 0, width: 1440, height: 80, bottom: 80 },
  metaLine: { left: 120, top: 50, width: 400, height: 24, bottom: 74 },
  title: { left: 120, top: 11, width: 600, height: 29, bottom: 40 },
  titleGhost: { left: 120, top: 11, width: 0, height: 0, bottom: 11 },
  neighbour: { left: 700, top: 12, width: 60, height: 24, bottom: 36 },
  comparisonRow: { left: 0, top: 81, width: 1440, height: 44, bottom: 125 },
  progressBar: { left: 0, top: 126, width: 1440, height: 3, bottom: 129 },
} satisfies Record<keyof HeaderParts, Box>;

const COLLAPSED_BOXES = {
  header: { left: 0, top: 0, width: 1440, height: 111, bottom: 111 },
  identityRow: { left: 0, top: 0, width: 1440, height: 66, bottom: 66 },
  metaLine: { left: 120, top: 37, width: 400, height: 20, bottom: 57 },
  title: { left: 120, top: 8, width: 300, height: 16, bottom: 24 },
  titleGhost: { left: 120, top: 8, width: 0, height: 0, bottom: 8 },
  neighbour: { left: 440, top: 9, width: 60, height: 20, bottom: 29 },
  comparisonRow: { left: 0, top: 66, width: 1440, height: 44, bottom: 110 },
  progressBar: { left: 0, top: 111, width: 1440, height: 3, bottom: 114 },
} satisfies Record<keyof HeaderParts, Box>;

let animations: RecordedAnimation[] = [];

function stubAnimate() {
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: function animate(
      this: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      const animation: RecordedAnimation = {
        target: this,
        keyframes,
        options,
        cancel: vi.fn(),
        onfinish: null,
      };
      animations.push(animation);
      return animation;
    },
  });
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function makeHeaderParts(): HeaderParts {
  const header = document.createElement("header");
  const identityRow = document.createElement("div");
  const titleBlock = document.createElement("div");
  const titleGhost = document.createElement("span");
  const titleLine = document.createElement("div");
  const title = document.createElement("h1");
  const neighbour = document.createElement("span");
  const metaLine = document.createElement("span");
  const comparisonRow = document.createElement("div");
  const progressBar = document.createElement("div");

  titleLine.append(title, neighbour);
  titleBlock.append(titleGhost, titleLine, metaLine);
  identityRow.append(titleBlock);
  header.append(identityRow, comparisonRow, progressBar);
  document.body.append(header);

  return {
    header,
    identityRow,
    metaLine,
    title,
    titleGhost,
    neighbour,
    comparisonRow,
    progressBar,
  };
}

function placeHeaderParts(
  parts: HeaderParts,
  boxes: Record<keyof HeaderParts, Box>,
  titleFont: string,
) {
  for (const key of Object.keys(boxes) as (keyof HeaderParts)[]) {
    const box = boxes[key];
    parts[key].getBoundingClientRect = () => box as DOMRect;
  }
  parts.title.style.fontSize = titleFont;
}

function renderCollapseMotion(parts: HeaderParts) {
  const headerRef = { current: parts.header };
  const view = renderHook(
    ({ collapsed }) => useCollapseMotion(headerRef, collapsed),
    { initialProps: { collapsed: false } },
  );
  view.result.current.identityRowRef.current = parts.identityRow;
  view.result.current.metaLineRef.current = parts.metaLine;
  view.result.current.titleRef.current = parts.title;
  view.result.current.titleGhostRef.current = parts.titleGhost;
  view.result.current.comparisonRowRef.current = parts.comparisonRow;
  view.result.current.progressBarRef.current = parts.progressBar;
  return view;
}

function collapseHeader(
  parts: HeaderParts,
  view: ReturnType<typeof renderCollapseMotion>,
) {
  placeHeaderParts(parts, REST_BOXES, "24px");
  view.result.current.captureCollapseStart();
  placeHeaderParts(parts, COLLAPSED_BOXES, "13px");
  view.rerender({ collapsed: true });
}

function findAnimation(target: Element): RecordedAnimation | undefined {
  return animations.find((animation) => animation.target === target);
}

beforeEach(() => {
  animations = [];
  stubAnimate();
  stubReducedMotion(false);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, "animate");
});

describe("useCollapseMotion", () => {
  it("moves the ghost from the outgoing title to the incoming one", () => {
    const parts = makeHeaderParts();
    const view = renderCollapseMotion(parts);

    collapseHeader(parts, view);

    const ghost = findAnimation(parts.titleGhost);
    expect(ghost?.keyframes).toEqual([
      { opacity: 1, transform: "translate(0px, -4px)" },
      {
        opacity: 0,
        transform: `translate(0px, 0px) scale(${String(1 / (24 / 13))})`,
      },
    ]);
    expect(parts.titleGhost.style.fontSize).toBe("24px");
    expect(parts.titleGhost.style.inlineSize).toBe("600px");
  });

  it("clears the ghost width once its fade finishes", () => {
    const parts = makeHeaderParts();
    const view = renderCollapseMotion(parts);

    collapseHeader(parts, view);
    findAnimation(parts.titleGhost)?.onfinish?.();

    expect(parts.titleGhost.style.inlineSize).toBe("");
  });

  it("slides the bar, rows and title neighbour from where they were", () => {
    const parts = makeHeaderParts();
    const view = renderCollapseMotion(parts);

    collapseHeader(parts, view);

    expect(findAnimation(parts.header)?.options.pseudoElement).toBe("::before");
    expect(findAnimation(parts.header)?.keyframes[0]).toEqual({
      transform: "translate(0px, 15px)",
    });
    expect(findAnimation(parts.identityRow)?.keyframes[0]).toEqual({
      transform: "translate(0px, 7px)",
    });
    expect(findAnimation(parts.neighbour)?.keyframes[0]).toEqual({
      transform: "translate(260px, -4px)",
    });
  });

  it("slides the progress bar with the header's edge", () => {
    const parts = makeHeaderParts();
    const view = renderCollapseMotion(parts);

    collapseHeader(parts, view);

    expect(findAnimation(parts.progressBar)?.keyframes).toEqual([
      { translate: "0 15px" },
      { translate: "none" },
    ]);
  });

  it("cancels a running collapse when the next one starts", () => {
    const parts = makeHeaderParts();
    const view = renderCollapseMotion(parts);

    collapseHeader(parts, view);
    const firstRun = [...animations];
    placeHeaderParts(parts, COLLAPSED_BOXES, "13px");
    view.result.current.captureCollapseStart();
    placeHeaderParts(parts, REST_BOXES, "24px");
    view.rerender({ collapsed: false });

    expect(firstRun.length).toBeGreaterThan(0);
    for (const animation of firstRun) {
      expect(animation.cancel).toHaveBeenCalledTimes(1);
    }
    expect(animations.length).toBe(firstRun.length * 2);
  });

  it("only fades the title in under reduced motion", () => {
    stubReducedMotion(true);
    const parts = makeHeaderParts();
    const view = renderCollapseMotion(parts);

    collapseHeader(parts, view);

    expect(animations).toHaveLength(1);
    expect(animations[0]?.target).toBe(parts.title);
    expect(animations[0]?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(parts.titleGhost.style.inlineSize).toBe("");
  });

  it("plays nothing when no box moved and the title has no font size", () => {
    const parts = makeHeaderParts();
    const view = renderCollapseMotion(parts);

    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      fontSize: "",
    } as CSSStyleDeclaration);
    placeHeaderParts(parts, REST_BOXES, "");
    view.result.current.captureCollapseStart();
    view.rerender({ collapsed: true });

    expect(animations).toHaveLength(0);
  });

  it("plays nothing on a render without a captured start", () => {
    const parts = makeHeaderParts();
    const view = renderCollapseMotion(parts);

    placeHeaderParts(parts, COLLAPSED_BOXES, "13px");
    view.rerender({ collapsed: true });

    expect(animations).toHaveLength(0);
  });
});

describe("COLLAPSE_TIMING", () => {
  it("matches the --header-collapse-ease token the stack controls read", () => {
    const tokens = readFileSync(TOKEN_STYLESHEET, "utf8");
    const collapseEase = readTokenValue(tokens, "--header-collapse-ease");
    const easeOut = readTokenValue(tokens, "--ease-out");

    expect(collapseEase).toBe(
      `${String(COLLAPSE_TIMING.duration)}ms var(--ease-out)`,
    );
    expect(easeOut).toBe(COLLAPSE_TIMING.easing);
  });
});
