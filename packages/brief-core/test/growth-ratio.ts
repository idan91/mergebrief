/** How many times larger the second input is than the first. */
export const GROWTH_FACTOR = 4;
/**
 * Linear work grows by `GROWTH_FACTOR`, quadratic work by its square; the
 * ceiling sits halfway between them on a log scale.
 */
export const LINEAR_GROWTH_CEILING = GROWTH_FACTOR * 2;
/** Odd, so the median is one pair's ratio. */
const MIN_SAMPLE_PAIRS = 5;
const MAX_SAMPLE_PAIRS = 9;
const MIN_SAMPLE_CPU_MS = 20;
const MICROSECONDS_PER_MS = 1_000;
/**
 * Wall time after which a measurement holding its minimum pairs returns the
 * median so far.
 */
const MEASUREMENT_BUDGET_MS = 5_000;

type Run = () => unknown;

/** One small and one large sample timed back to back, each per call. */
interface SamplePair {
  readonly smallCallMs: number;
  readonly largeCallMs: number;
  readonly smallSampleMs: number;
}

/**
 * CPU time of this thread, not wall time: a busy runner delays the thread
 * but cannot bill it for the time it waited, so neighbour load drops out.
 */
function timeRepetitions(run: Run, repetitions: number): number {
  const started = process.threadCpuUsage();
  for (let repetition = 0; repetition < repetitions; repetition++) {
    run();
  }
  const used = process.threadCpuUsage(started);
  return (used.user + used.system) / MICROSECONDS_PER_MS;
}

/**
 * Doubles `repetitions` until the small input, run `GROWTH_FACTOR` times that
 * often, spans `MIN_SAMPLE_CPU_MS`.
 */
function calibrateRepetitions(small: Run, repetitions: number): number {
  let calibrated = repetitions;
  while (
    timeRepetitions(small, calibrated * GROWTH_FACTOR) < MIN_SAMPLE_CPU_MS
  ) {
    calibrated *= 2;
  }
  return calibrated;
}

/** Odd pairs time the large input first, so a steady drift cancels. */
function timeSamplePair(
  small: Run,
  large: Run,
  repetitions: number,
  largeFirst: boolean,
): SamplePair {
  const smallRepetitions = repetitions * GROWTH_FACTOR;
  let largeSampleMs = 0;
  if (largeFirst) {
    largeSampleMs = timeRepetitions(large, repetitions);
  }
  const smallSampleMs = timeRepetitions(small, smallRepetitions);
  if (!largeFirst) {
    largeSampleMs = timeRepetitions(large, repetitions);
  }
  return {
    smallCallMs: smallSampleMs / smallRepetitions,
    largeCallMs: largeSampleMs / repetitions,
    smallSampleMs,
  };
}

function findMedian(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? Number.NaN;
  }
  const below = sorted[middle - 1] ?? Number.NaN;
  const above = sorted[middle] ?? Number.NaN;
  return (below + above) / 2;
}

/**
 * How much more CPU time `prepareRun`'s work takes on an input
 * `GROWTH_FACTOR` times larger. Each pair times both sizes back to back, the
 * small input `GROWTH_FACTOR` times as often, and the ratio is the median of
 * the pairs' ratios, so a pair whose samples ran on different core types or
 * cache states cannot move it alone.
 */
export function measureGrowthRatio(prepareRun: (scale: number) => Run): number {
  const deadline = performance.now() + MEASUREMENT_BUDGET_MS;
  const small = prepareRun(1);
  const large = prepareRun(GROWTH_FACTOR);
  const coldRepetitions = calibrateRepetitions(small, 1);
  timeRepetitions(large, coldRepetitions);
  let repetitions = calibrateRepetitions(small, coldRepetitions);

  const pairs: SamplePair[] = [];
  while (pairs.length < MAX_SAMPLE_PAIRS) {
    const largeFirst = pairs.length % 2 === 1;
    const pair = timeSamplePair(small, large, repetitions, largeFirst);
    pairs.push(pair);
    if (pair.smallSampleMs < MIN_SAMPLE_CPU_MS) {
      repetitions *= 2;
    }

    const budgetSpent = performance.now() >= deadline;
    if (budgetSpent && pairs.length >= MIN_SAMPLE_PAIRS) {
      break;
    }
  }
  return findMedian(pairs.map((pair) => pair.largeCallMs / pair.smallCallMs));
}
