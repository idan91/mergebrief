import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { LineRange } from "../types";
import {
  fileRangeQueryOptions,
  isFileRangeReadable,
  type FileRangeParams,
  type FileRangeResult,
} from "../queries";
import type { ExpansionSource } from "./useExpansionSource";

export interface UseFileRangeInput {
  source: ExpansionSource | undefined;
  path: string;
  /** The windows already read at this file's edges; each is one query. */
  windows: readonly LineRange[];
}

export type FileRangeLines = ReadonlyMap<number, string>;

/**
 * The lines of every window the file's edges have read, keyed by head-file
 * line. Each window stays its own query so a repeat read is a cache hit and a
 * window the cache dropped refetches on its own.
 */
export function useFileRange(input: UseFileRangeInput): FileRangeLines {
  const { source, path, windows } = input;
  const queries = useMemo(
    () =>
      source === undefined
        ? []
        : windows
            .map((window) => buildParams(source, path, window))
            .filter(isFileRangeReadable)
            .map((params) => fileRangeQueryOptions(params)),
    [source, path, windows],
  );

  return useQueries({
    queries,
    combine: combineFileRanges,
  });
}

/** Reads one window now, for the click that expands an edge. */
export function useFileRangeReader(
  source: ExpansionSource | undefined,
  path: string,
): (window: LineRange) => Promise<FileRangeResult | undefined> {
  const queryClient = useQueryClient();

  return async (window) => {
    if (source === undefined) return undefined;
    const params = buildParams(source, path, window);
    if (!isFileRangeReadable(params)) return undefined;

    return queryClient.fetchQuery(fileRangeQueryOptions(params));
  };
}

function buildParams(
  source: ExpansionSource,
  path: string,
  window: LineRange,
): FileRangeParams {
  return {
    repoId: source.repoId,
    prNumber: source.prNumber,
    ref: source.ref,
    path,
    from: window.start,
    to: window.end,
  };
}

function combineFileRanges(
  results: readonly { data: FileRangeResult | undefined }[],
): FileRangeLines {
  const lines = new Map<number, string>();

  for (const result of results) {
    const data = result.data;
    if (data?.kind !== "ready") continue;
    data.range.lines.forEach((content, offset) => {
      lines.set(data.range.from + offset, content);
    });
  }

  return lines;
}
