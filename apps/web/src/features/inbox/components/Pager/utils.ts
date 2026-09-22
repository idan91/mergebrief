export const PAGE_GAP = "gap";

export type PagerStep = number | typeof PAGE_GAP;

/** The first, the last and the current page's neighbours, with a gap where numbers are skipped. */
export function listPageSteps(
  current: number,
  last: number,
): readonly PagerStep[] {
  const wanted = [1, last, current - 1, current, current + 1]
    .filter((page) => page >= 1 && page <= last)
    .toSorted((first, second) => first - second);
  const steps: PagerStep[] = [];
  for (const page of wanted) {
    const previous = steps.at(-1);
    if (previous === page) continue;
    if (typeof previous === "number" && page - previous > 1)
      steps.push(PAGE_GAP);
    steps.push(page);
  }
  return steps;
}
