import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import { prefersReducedMotion } from "@web/utils/motion";
import {
  deriveCollapseShifts,
  deriveGhostPath,
  hasCollapseMovement,
  type CollapseLayout,
  type CollapsePoint,
  type CollapseShifts,
} from "./utils";

/**
 * Mirrors --header-collapse-ease, which the meta controls' size transitions
 * read: a Web Animation cannot read a custom property.
 */
export const COLLAPSE_TIMING = {
  duration: 180,
  easing: "cubic-bezier(0.23, 1, 0.32, 1)",
};

export interface CollapseMotion {
  captureCollapseStart: () => void;
  comparisonRowRef: RefObject<HTMLDivElement | null>;
  identityRowRef: RefObject<HTMLDivElement | null>;
  metaLineRef: RefObject<HTMLSpanElement | null>;
  progressBarRef: RefObject<HTMLDivElement | null>;
  titleGhostRef: RefObject<HTMLSpanElement | null>;
  titleRef: RefObject<HTMLHeadingElement | null>;
}

function readPoint(element: Element): CollapsePoint {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top };
}

function readTitleNeighbours(title: Element): Element[] {
  const siblings = title.parentElement?.children ?? [];
  return [...siblings].filter((sibling) => sibling !== title);
}

function buildTranslate({ x, y }: CollapsePoint): string {
  return `translate(${String(x)}px, ${String(y)}px)`;
}

function playSlide(element: Element, offset: CollapsePoint): Animation {
  return element.animate(
    [{ transform: buildTranslate(offset) }, { transform: "none" }],
    COLLAPSE_TIMING,
  );
}

/** `translate`, not `transform`: the progress bar's own transform is its fill. */
function playProgressSlide(progressBar: Element, offsetY: number): Animation {
  return progressBar.animate(
    [{ translate: `0 ${String(offsetY)}px` }, { translate: "none" }],
    COLLAPSE_TIMING,
  );
}

interface CollapseParts {
  comparisonRow: HTMLElement;
  header: HTMLElement;
  identityRow: HTMLElement;
  metaLine: HTMLElement;
  progressBar: HTMLElement;
  title: HTMLElement;
  titleGhost: HTMLElement;
}

interface CollapseFrames {
  start: CollapseLayout;
  end: CollapseLayout;
  shifts: CollapseShifts;
  titleWidth: number;
}

function playCollapse(
  {
    comparisonRow,
    header,
    identityRow,
    metaLine,
    progressBar,
    title,
    titleGhost,
  }: CollapseParts,
  { start, end, shifts, titleWidth }: CollapseFrames,
): Animation[] {
  const fadeIn = [{ opacity: 0 }, { opacity: 1 }];
  if (prefersReducedMotion()) {
    return [title.animate(fadeIn, COLLAPSE_TIMING)];
  }

  const ghostOrigin = readPoint(titleGhost);
  titleGhost.style.fontSize = `${String(start.titleFontPixels)}px`;
  titleGhost.style.inlineSize = `${String(titleWidth)}px`;
  const ghostPath = deriveGhostPath({ start, end, ghostOrigin, shifts });

  const neighbours = readTitleNeighbours(title);
  const ghostFade = titleGhost.animate(
    [
      { opacity: 1, transform: buildTranslate(ghostPath.from) },
      {
        opacity: 0,
        transform: `${buildTranslate(ghostPath.to)} scale(${String(ghostPath.endScale)})`,
      },
    ],
    COLLAPSE_TIMING,
  );
  ghostFade.onfinish = () => {
    titleGhost.style.inlineSize = "";
  };
  return [
    ghostFade,
    header.animate(
      [
        { transform: buildTranslate({ x: 0, y: shifts.bar }) },
        { transform: "none" },
      ],
      { ...COLLAPSE_TIMING, pseudoElement: "::before" },
    ),
    playProgressSlide(progressBar, shifts.bar),
    playSlide(identityRow, { x: 0, y: shifts.identity }),
    playSlide(metaLine, { x: 0, y: shifts.meta }),
    playSlide(comparisonRow, { x: 0, y: shifts.comparison }),
    ...neighbours.map((neighbour, index) =>
      playSlide(neighbour, shifts.titleNeighbours[index] ?? { x: 0, y: 0 }),
    ),
    title.animate(
      [
        {
          opacity: 0,
          transform: `${buildTranslate(shifts.title)} scale(${String(shifts.titleScale)})`,
        },
        { opacity: 1, transform: "none" },
      ],
      COLLAPSE_TIMING,
    ),
  ];
}

/**
 * Swaps the Header's two heights in one layout and paints the change with
 * transforms alone: every part starts where the old layout had it, and the two
 * title sizes crossfade. Sticky siblings read --top-bar-h, which therefore
 * changes once rather than per frame.
 */
export function useCollapseMotion(
  headerRef: RefObject<HTMLElement | null>,
  collapsed: boolean,
): CollapseMotion {
  const comparisonRowRef = useRef<HTMLDivElement>(null);
  const identityRowRef = useRef<HTMLDivElement>(null);
  const metaLineRef = useRef<HTMLSpanElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const titleGhostRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const startRef = useRef<CollapseLayout | undefined>(undefined);
  const titleWidthRef = useRef(0);
  const runningRef = useRef<Animation[]>([]);

  const readLayout = useCallback((): CollapseLayout | undefined => {
    const header = headerRef.current;
    const identityRow = identityRowRef.current;
    const metaLine = metaLineRef.current;
    const title = titleRef.current;
    const comparisonRow = comparisonRowRef.current;
    if (!header || !identityRow || !metaLine || !title || !comparisonRow) {
      return undefined;
    }

    const identityBox = identityRow.getBoundingClientRect();
    return {
      barBottom: header.getBoundingClientRect().bottom,
      comparisonTop: comparisonRow.getBoundingClientRect().top,
      identityCentre: identityBox.top + identityBox.height / 2,
      metaTop: metaLine.getBoundingClientRect().top,
      titleNeighbours: readTitleNeighbours(title).map(readPoint),
      title: readPoint(title),
      titleFontPixels: Number.parseFloat(getComputedStyle(title).fontSize),
    };
  }, [headerRef]);

  const captureCollapseStart = useCallback(() => {
    startRef.current = readLayout();
    titleWidthRef.current =
      titleRef.current?.getBoundingClientRect().width ?? 0;
  }, [readLayout]);

  useLayoutEffect(() => {
    const start = startRef.current;
    startRef.current = undefined;
    if (!start) {
      return;
    }

    for (const animation of runningRef.current) {
      animation.cancel();
    }
    runningRef.current = [];

    const end = readLayout();
    const header = headerRef.current;
    const identityRow = identityRowRef.current;
    const metaLine = metaLineRef.current;
    const progressBar = progressBarRef.current;
    const title = titleRef.current;
    const titleGhost = titleGhostRef.current;
    const comparisonRow = comparisonRowRef.current;
    if (
      !end ||
      !header ||
      !identityRow ||
      !metaLine ||
      !progressBar ||
      !title ||
      !titleGhost ||
      !comparisonRow
    ) {
      return;
    }

    const shifts = deriveCollapseShifts(start, end);
    if (!hasCollapseMovement(shifts)) {
      return;
    }

    runningRef.current = playCollapse(
      {
        comparisonRow,
        header,
        identityRow,
        metaLine,
        progressBar,
        title,
        titleGhost,
      },
      { start, end, shifts, titleWidth: titleWidthRef.current },
    );
  }, [collapsed, headerRef, readLayout]);

  return {
    captureCollapseStart,
    comparisonRowRef,
    identityRowRef,
    metaLineRef,
    progressBarRef,
    titleGhostRef,
    titleRef,
  };
}
