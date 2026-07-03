/**
 * Feature-specific revision-change navigation. DOM-driven on purpose — the rail
 * positions live in the rendered diff (`main [data-jump-target]`, set by
 * `RevisionGutterCell`), so this is the single place coupled to that markup.
 * A data attribute, not a class selector: CSS-module classnames are hashed at
 * build time, so a class-based query here would silently match nothing.
 * Steps focus to the next/prev rendered revision rail relative to the reading
 * line, wrapping at the ends.
 */
export interface RevisionNavigation {
  jumpNext: () => void;
  jumpPrev: () => void;
}

const JUMP_TARGET_SELECTOR = "main [data-jump-target]";

/**
 * Pick the next/prev rail button relative to the reading line, wrapping at the
 * ends. Pure and DOM-independent (given already-measured tops) so it's unit
 * testable without a real layout — the DOM-coupled part is only measuring
 * `top` for each rail, done by the caller.
 */
export function findJumpTarget<T>(
  rails: readonly T[],
  tops: readonly number[],
  direction: 1 | -1,
  readingLine: number,
): T | undefined {
  if (rails.length === 0) return undefined;
  const indexed = rails.map((rail, index) => ({ rail, top: tops[index] ?? 0 }));
  if (direction === 1) {
    return (
      indexed.find((entry) => entry.top > readingLine + 1)?.rail ?? rails[0]
    );
  }
  return (
    indexed.findLast((entry) => entry.top < readingLine - 1)?.rail ??
    rails[rails.length - 1]
  );
}

function jumpToRevisionChange(direction: 1 | -1): void {
  const rails = [
    ...document.querySelectorAll<HTMLButtonElement>(JUMP_TARGET_SELECTOR),
  ];
  if (rails.length === 0) return;
  const readingLine = window.scrollY + 160;
  const tops = rails.map(
    (rail) => rail.getBoundingClientRect().top + window.scrollY,
  );
  const target = findJumpTarget(rails, tops, direction, readingLine);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus();
}

export function useRevisionNavigation(): RevisionNavigation {
  return {
    jumpNext: () => jumpToRevisionChange(1),
    jumpPrev: () => jumpToRevisionChange(-1),
  };
}
