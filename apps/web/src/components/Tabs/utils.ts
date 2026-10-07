export function deriveTabId(baseId: string, value: string): string {
  return `${baseId}-tab-${value}`;
}

export function derivePanelId(baseId: string, value: string): string {
  return `${baseId}-panel-${value}`;
}

export function resolveNextIndex(
  key: string,
  index: number,
  count: number,
): number {
  if (key === "ArrowRight") {
    return (index + 1) % count;
  }
  if (key === "ArrowLeft") {
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
