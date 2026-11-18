export function describe(count: number): string {
  const suffix = count === 1 ? "" : "s";
  const reversed = count !== 1 ? "s" : "";
  return `${count} thread${suffix}${reversed}`;
}
