/**
 * Feature-specific revision-change navigation. DOM-driven on purpose — the rail
 * positions live in the rendered diff (`main .diff .railbtn`), so this is the
 * single place coupled to that markup. Steps focus to the next/prev rendered
 * revision rail relative to the reading line, wrapping at the ends.
 */
export interface RevisionNavigation {
  jumpNext: () => void;
  jumpPrev: () => void;
}

function jumpToRevisionChange(direction: 1 | -1): void {
  const rails = [
    ...document.querySelectorAll<HTMLButtonElement>("main .diff .railbtn"),
  ];
  if (rails.length === 0) return;
  const readingLine = window.scrollY + 160;
  const top = (rail: HTMLButtonElement): number =>
    rail.getBoundingClientRect().top + window.scrollY;
  const target =
    direction === 1
      ? (rails.find((rail) => top(rail) > readingLine + 1) ?? rails[0])
      : ([...rails].reverse().find((rail) => top(rail) < readingLine - 1) ??
        rails[rails.length - 1]);
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
