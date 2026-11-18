// Shared PERF_RESULT emitter for the perf specs: one JSON line per metric,
// grep-able from the runner output for PR bodies.

// Field names are unit-neutral: the metric name carries the unit (`-px`
// metrics ride the same emitter as millisecond timings).
export interface MetricReport {
  metric: string;
  samples: number[];
  median: number;
  min: number;
  max: number;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function report(metric: string, samples: number[]): void {
  const sorted = [...samples].toSorted((a, b) => a - b);
  const payload: MetricReport = {
    metric,
    samples: samples.map((sample) => Math.round(sample)),
    median: Math.round(median(sorted)),
    min: Math.round(sorted[0] ?? 0),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
  };
  console.log(`PERF_RESULT ${JSON.stringify(payload)}`);
}

/** p95 by nearest-rank, for frame-gap style sample sets. */
export function p95(samples: number[]): number {
  const sorted = [...samples].toSorted((a, b) => a - b);
  const rank = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, rank)] ?? 0;
}
