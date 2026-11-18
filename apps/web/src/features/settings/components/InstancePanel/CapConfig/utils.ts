export function buildSpendBlock(cap: number): string {
  const block = `spend:\n  maxGenerationsPerDay: ${cap}`;
  return block;
}
