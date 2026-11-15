// How long each SSR read of the API took within one inbound request, reported
// to the browser as a `Server-Timing` header.
import "@tanstack/react-start/server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { HttpMethod } from "types";

/** One read of the API, offset from the start of its request's log. */
export interface ApiReadTiming {
  readonly method: HttpMethod;
  readonly path: string;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface TimedRun<Value> {
  readonly value: Value;
  readonly reads: readonly ApiReadTiming[];
}

interface ReadTimingLog {
  readonly clock: () => number;
  readonly originMs: number;
  readonly reads: ApiReadTiming[];
}

const READ_METRIC = "api";
const TOTAL_METRIC = "api-total";
const TENTHS_PER_MS = 10;
const QUERY_START = /[?#]/;
const NON_PRINTABLE_ASCII = /[^\x20-\x7e]/g;
const QUOTED_STRING_SPECIALS = /["\\]/g;

const activeLog = new AsyncLocalStorage<ReadTimingLog>();

function readMonotonicClock(): number {
  return performance.now();
}

function stripQuery(path: string): string {
  const queryStart = path.search(QUERY_START);
  if (queryStart === -1) {
    return path;
  }
  return path.slice(0, queryStart);
}

/** Runs `run` inside a fresh log; the reads are those finished when it settles. */
export async function runWithReadTimings<Value>(
  run: () => Value | Promise<Value>,
  clock: () => number = readMonotonicClock,
): Promise<TimedRun<Value>> {
  const log: ReadTimingLog = { clock, originMs: clock(), reads: [] };
  const value = await activeLog.run(log, run);
  return { value, reads: [...log.reads] };
}

/** Times `read` into the current log; outside a run it only reads. */
export async function timeApiRead<Value>(
  method: HttpMethod,
  path: string,
  read: () => Promise<Value>,
): Promise<Value> {
  const log = activeLog.getStore();
  if (log === undefined) {
    return read();
  }

  const startedAtMs = log.clock();
  try {
    return await read();
  } finally {
    const endedAtMs = log.clock();
    log.reads.push({
      method,
      path: stripQuery(path),
      startMs: startedAtMs - log.originMs,
      durationMs: endedAtMs - startedAtMs,
    });
  }
}

function roundToTenth(ms: number): number {
  return Math.round(ms * TENTHS_PER_MS) / TENTHS_PER_MS;
}

function quoteDescription(description: string): string {
  const printable = description.replace(NON_PRINTABLE_ASCII, "");
  return `"${printable.replace(QUOTED_STRING_SPECIALS, "\\$&")}"`;
}

function formatReadMetric(read: ApiReadTiming): string {
  const description = `${read.method} ${read.path} @${String(roundToTenth(read.startMs))}ms`;
  return `${READ_METRIC};desc=${quoteDescription(description)};dur=${String(roundToTenth(read.durationMs))}`;
}

export function formatServerTiming(
  reads: readonly ApiReadTiming[],
): string | undefined {
  if (reads.length === 0) {
    return undefined;
  }

  const ordered = reads.toSorted((left, right) => left.startMs - right.startMs);
  const firstStartMs = Math.min(...ordered.map((read) => read.startMs));
  const lastEndMs = Math.max(
    ...ordered.map((read) => read.startMs + read.durationMs),
  );
  const totalMs = roundToTenth(lastEndMs - firstStartMs);

  const metrics = ordered.map(formatReadMetric);
  metrics.push(`${TOTAL_METRIC};dur=${String(totalMs)}`);
  return metrics.join(", ");
}
