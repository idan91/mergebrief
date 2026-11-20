import { formatPatch, OMIT_HEADERS, structuredPatch } from "diff";
import {
  LINE_DIFF_CONTEXT_LINES,
  LINE_DIFF_MAX_EDIT_LENGTH,
  LINE_DIFF_TIMEOUT_MS,
  MAX_LINE_DIFF_BYTES,
  UTF8_BYTES_PER_UNIT,
} from "../consts";
import type { ModeChange } from "../types";
import {
  formatDiffHeader,
  formatFileLines,
  type BetweenHeadsHeader,
} from "./git-headers";

export interface BetweenHeadsContents {
  readonly prevPath: string;
  readonly path: string;
  /** Absent: no file at that head. */
  readonly prevContent?: string | undefined;
  readonly newContent?: string | undefined;
  readonly modeChange?: ModeChange | undefined;
  readonly prevMode?: string | undefined;
  readonly newMode?: string | undefined;
}

export interface LineDiffBounds {
  readonly maxEditLength: number;
  readonly timeoutMs: number;
}

/** One changed file's line diff, under the edit length the span's work bound affords it. */
export interface LineDiffInput {
  readonly contents: BetweenHeadsContents;
  readonly maxEditLength: number;
}

/** A runner's own failure, such as its thread stopping: infrastructure, never a verdict on the file. */
export class SpanRunnerError extends Error {
  override readonly name: string = "SpanRunnerError";
}

/**
 * Runs one file's line diff: the patch, or nothing when a bound sends the
 * file to its fallback. Rejects with a `SpanRunnerError` when the runner
 * itself fails, and with the signal's reason once it aborts. A span read awaits each file before
 * the next, so one read holds at most one diff in a runner at a time.
 */
export type LineDiffRunner = (
  input: LineDiffInput,
  signal: AbortSignal,
) => Promise<string | undefined>;

const DEFAULT_BOUNDS: LineDiffBounds = {
  maxEditLength: LINE_DIFF_MAX_EDIT_LENGTH,
  timeoutMs: LINE_DIFF_TIMEOUT_MS,
};

const UTF8_ENCODER = new TextEncoder();

export function isPastByteBound(content: string | undefined): boolean {
  if (content === undefined) {
    return false;
  }
  // A UTF-16 unit is at most three UTF-8 bytes, so only a string that could pass the bound gets encoded.
  const mayPassBound =
    content.length * UTF8_BYTES_PER_UNIT > MAX_LINE_DIFF_BYTES;
  return (
    mayPassBound && UTF8_ENCODER.encode(content).length > MAX_LINE_DIFF_BYTES
  );
}

/**
 * One file's git-style patch from the previous head to the new head, three
 * lines of context. The caller refuses a side past the byte bound first.
 * Nothing when the diff passes its edit bound, or its time bound, a
 * crash-only stop the span's work bound keeps out of reach.
 */
export function formatBetweenHeadsPatch(
  contents: BetweenHeadsContents,
  bounds: LineDiffBounds = DEFAULT_BOUNDS,
): string | undefined {
  const structured = structuredPatch(
    contents.prevPath,
    contents.path,
    contents.prevContent ?? "",
    contents.newContent ?? "",
    undefined,
    undefined,
    {
      context: LINE_DIFF_CONTEXT_LINES,
      maxEditLength: bounds.maxEditLength,
      timeout: bounds.timeoutMs,
    },
  );
  if (structured === undefined) {
    return undefined;
  }

  const header: BetweenHeadsHeader = {
    prevPath: contents.prevPath,
    path: contents.path,
    existsAtPrev: contents.prevContent !== undefined,
    existsAtNew: contents.newContent !== undefined,
    modeChange: contents.modeChange,
    prevMode: contents.prevMode,
    newMode: contents.newMode,
  };
  const lines = formatDiffHeader(header);
  if (structured.hunks.length === 0) {
    return lines.join("\n");
  }
  const formatted = formatPatch(structured, OMIT_HEADERS);
  const hunks = formatted.endsWith("\n") ? formatted.slice(0, -1) : formatted;
  return [...lines, ...formatFileLines(header), hunks].join("\n");
}

/**
 * The line diff every runner computes, so a span's text does not depend on
 * where it ran: only a test passes `timeoutMs`.
 */
export function formatLineDiffPatch(
  input: LineDiffInput,
  timeoutMs = LINE_DIFF_TIMEOUT_MS,
): string | undefined {
  return formatBetweenHeadsPatch(input.contents, {
    maxEditLength: input.maxEditLength,
    timeoutMs,
  });
}

/** The runner the worker and the dev CLI keep: the line diff on the calling thread. */
export function runLineDiffInProcess(
  input: LineDiffInput,
): Promise<string | undefined> {
  return Promise.resolve(formatLineDiffPatch(input));
}
