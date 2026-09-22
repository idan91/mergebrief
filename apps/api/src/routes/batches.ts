/**
 * Run `work` over `entries` at most `width` at a time, keeping order. A
 * batch holding an outcome `stopWhen` accepts is the last one run; the
 * outcomes so far come back and the remaining entries are never started.
 */
export async function runInBatches<Entry, Outcome>(
  entries: readonly Entry[],
  width: number,
  work: (entry: Entry) => Promise<Outcome>,
  stopWhen?: (outcome: Outcome) => boolean,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (let start = 0; start < entries.length; start += width) {
    const batch = entries.slice(start, start + width);
    // Sequential on purpose: each batch bounds what runs at once.
    const done = await Promise.all(batch.map(work));
    outcomes.push(...done);
    if (stopWhen !== undefined && done.some(stopWhen)) break;
  }
  return outcomes;
}
