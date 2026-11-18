export function stubClock(readings: readonly number[]): () => number {
  let next = 0;
  return () => {
    const reading = readings[next];
    if (reading === undefined) {
      throw new Error(`stub clock read ${String(next + 1)} times`);
    }
    next += 1;
    return reading;
  };
}
