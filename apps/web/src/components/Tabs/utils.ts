export function deriveTabId(baseId: string, value: string): string {
  return `${baseId}-tab-${value}`;
}

export function derivePanelId(baseId: string, value: string): string {
  return `${baseId}-panel-${value}`;
}

function isNextKey(key: string, vertical: boolean): boolean {
  const downOnRail = vertical && key === "ArrowDown";
  const next = key === "ArrowRight" || downOnRail;
  return next;
}

function isPreviousKey(key: string, vertical: boolean): boolean {
  const upOnRail = vertical && key === "ArrowUp";
  const previous = key === "ArrowLeft" || upOnRail;
  return previous;
}

export function resolveNextIndex(
  key: string,
  index: number,
  count: number,
  vertical = false,
): number {
  if (isNextKey(key, vertical)) {
    return (index + 1) % count;
  }
  if (isPreviousKey(key, vertical)) {
    return (index - 1 + count) % count;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return count - 1;
  }
  return -1;
}
