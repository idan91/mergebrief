import type { LineRange } from "brief-core/types";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { FileRangeResultKinds } from "../types";
import {
  buildFileRangeQueryOptions,
  isFileRangeReadable,
  type FileRangeParams,
  type FileRangeResult,
} from "../../queries";
import type { ExpansionSource } from "./useExpansionSource";

export interface UseFileRangeInput {
  source: ExpansionSource | undefined;
  path: string;
  /** The ranges already read at this file's edges; each is one query. */
  ranges: readonly LineRange[];
}

export type FileRangeLines = ReadonlyMap<number, string>;

/**
 * The lines of every range the file's edges have read, keyed by head-file
 * line. Each range stays its own query so a repeat read is a cache hit and a
 * range the cache dropped refetches on its own.
 */
export function useFileRange(input: UseFileRangeInput): FileRangeLines {
  const { source, path, ranges } = input;
  const queries = useMemo(
    () =>
      source === undefined
        ? []
        : ranges
            .map((range) => buildParams(source, path, range))
            .filter(isFileRangeReadable)
            .map((params) => buildFileRangeQueryOptions(params)),
    [source, path, ranges],
  );

  return useQueries({
    queries,
    combine: combineFileRanges,
  });
}

/** Reads one range now, for the click that expands an edge. */
export function useFileRangeReader(
  source: ExpansionSource | undefined,
  path: string,
): (range: LineRange) => Promise<FileRangeResult | undefined> {
  const queryClient = useQueryClient();

  return async (range) => {
    if (source === undefined) {
      return undefined;
    }
    const params = buildParams(source, path, range);
    if (!isFileRangeReadable(params)) {
      return undefined;
    }

    return queryClient.fetchQuery(buildFileRangeQueryOptions(params));
  };
}

function buildParams(
  source: ExpansionSource,
  path: string,
  range: LineRange,
): FileRangeParams {
  return {
    repoId: source.repoId,
    prNumber: source.prNumber,
    ref: source.ref,
    path,
    from: range.start,
    to: range.end,
  };
}

function combineFileRanges(
  results: readonly { data: FileRangeResult | undefined }[],
): FileRangeLines {
  const lines = new Map<number, string>();

  for (const result of results) {
    const data = result.data;
    if (data?.kind !== FileRangeResultKinds.READY) {
      continue;
    }
    data.range.lines.forEach((content, offset) => {
      lines.set(data.range.from + offset, content);
    });
  }

  return lines;
}
