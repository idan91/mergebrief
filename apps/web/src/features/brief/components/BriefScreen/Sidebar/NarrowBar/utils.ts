/** The stepper only needs identity, never group content. */
export interface GroupStepTarget {
  readonly id: string;
}

/** Clamped, never wrapping; with no current group either direction lands on the first. */
export function resolveStepTarget(
  groups: readonly GroupStepTarget[],
  activeGroupId: string | null,
  direction: 1 | -1,
): string | undefined {
  const activeIndex = groups.findIndex((group) => group.id === activeGroupId);
  if (activeIndex === -1) return groups[0]?.id;

  const clamped = Math.min(
    groups.length - 1,
    Math.max(0, activeIndex + direction),
  );
  return groups[clamped]?.id;
}
