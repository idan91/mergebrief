import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  parseChangedRanges,
  type PrLocator,
  type PrMetadata,
} from "brief-core";
import type { LineRange, ReviewComment } from "brief-core/types";
import {
  readPrSpan,
  type PrDiffRef,
  type PrSpanRefs,
  type PrSpanSource,
} from "brief-core/pr-span";
import type { Result } from "types/utils";
import type { PrSource } from "../src/github";
import { PAIR_FILE, type PairFixtureFile } from "./pairs";

/** A capture past this many bytes is written gzipped. */
export const PAIR_GZIP_BYTES = 1024 * 1024;

/** The PR reads a capture needs beyond the span itself. */
export interface PairCaptureReads extends Pick<
  PrSource,
  "fetchPrMetadata" | "fetchCompareDiff" | "fetchCompareCommitCount"
> {
  fetchReviewCommentsCreatedBy(
    loc: PrLocator,
    createdBy: string,
  ): Promise<ReviewComment[]>;
  fetchCommitDate(loc: PrLocator, sha: string): Promise<string>;
}

export interface PairCaptureRequest {
  locator: PrLocator;
  prevHead: string;
  head: string;
  /** The previous head's base when the PR was retargeted; the PR's current base otherwise. */
  prevBase?: string;
  base?: string;
}

type CaptureSide = PairFixtureFile["base"];

/**
 * One real revision pair through the production span read: both heads' PR
 * diffs, the filtered and unfiltered spans, and the review comments created
 * by the head's committer date. The pair's metadata is the PR's as read now,
 * its title and body included; links are not read. Compare files are not
 * recorded, so anchoring re-looks every group.
 */
export async function capturePair(
  reads: PairCaptureReads,
  spanSource: PrSpanSource,
  request: PairCaptureRequest,
  signal: AbortSignal,
): Promise<Result<PairFixtureFile, string>> {
  const { locator, prevHead, head } = request;
  const meta = await reads.fetchPrMetadata(locator);
  const refs: PrSpanRefs = {
    prevBase: request.prevBase ?? meta.baseSha,
    prevHead,
    newBase: request.base ?? meta.baseSha,
    newHead: head,
  };

  const recorded = recordPrDiffs(spanSource);
  const span = await readPrSpan(recorded.source, refs, signal);
  if (!span.ok) {
    return {
      ok: false,
      error: `revision span read failed: ${span.error.kind}`,
    };
  }
  const prevPrDiff = recorded.diffs.get(
    formatPrDiffKey(refs.prevBase, prevHead),
  );
  const newPrDiff = recorded.diffs.get(formatPrDiffKey(refs.newBase, head));
  if (prevPrDiff === undefined || newPrDiff === undefined) {
    throw new Error("the span read returned without reading both PR diffs");
  }

  const headDate = await reads.fetchCommitDate(locator, head);
  const [comments, incrementalDiff, prevCount, newCount] = await Promise.all([
    reads.fetchReviewCommentsCreatedBy(locator, headDate),
    reads.fetchCompareDiff(locator, prevHead, head),
    reads.fetchCompareCommitCount(locator, refs.prevBase, prevHead),
    reads.fetchCompareCommitCount(locator, refs.newBase, head),
  ]);
  const value: PairFixtureFile = {
    base: shapeCaptureSide(locator, meta, {
      base: refs.prevBase,
      head: prevHead,
      diff: prevPrDiff,
      commitCount: prevCount,
    }),
    revised: shapeCaptureSide(locator, meta, {
      base: refs.newBase,
      head,
      diff: newPrDiff,
      commitCount: newCount,
    }),
    increment: {
      incrementalDiff,
      compareFiles: { files: [], complete: false },
      baseShaMoved: refs.prevBase !== refs.newBase,
      filteredSpan: span.value.filteredDiff,
      unfilteredSpan: span.value.unfilteredDiff,
    },
    reviewComments: comments,
  };
  return { ok: true, value };
}

/** Write the capture into `dir` as pair.json, or pair.json.gz past the size bound; never over an existing one. */
export function writePairCapture(
  dir: string,
  file: PairFixtureFile,
): Result<string, string> {
  const gzippedName = `${PAIR_FILE}.gz`;
  const exists =
    existsSync(join(dir, PAIR_FILE)) || existsSync(join(dir, gzippedName));
  if (exists) {
    return { ok: false, error: `${dir} already holds a pair capture` };
  }

  mkdirSync(dir, { recursive: true });
  const text = `${JSON.stringify(file, null, 2)}\n`;
  if (Buffer.byteLength(text) <= PAIR_GZIP_BYTES) {
    const path = join(dir, PAIR_FILE);
    writeFileSync(path, text);
    return { ok: true, value: path };
  }
  const path = join(dir, gzippedName);
  writeFileSync(path, gzipSync(text));
  return { ok: true, value: path };
}

interface CaptureHead extends PrDiffRef {
  diff: string;
  commitCount: number;
}

function shapeCaptureSide(
  locator: PrLocator,
  meta: PrMetadata,
  side: CaptureHead,
): CaptureSide {
  return {
    pr: {
      locator,
      meta: {
        title: meta.title,
        body: meta.body,
        url: meta.url,
        sha: side.head,
        baseSha: side.base,
        commitCount: side.commitCount,
        files: listPrFiles(side.diff),
      },
      diff: side.diff,
      links: [],
    },
    commitRange: {
      base: side.base,
      head: side.head,
      commitCount: side.commitCount,
    },
  };
}

type CapturePrFile = CaptureSide["pr"]["meta"]["files"][number];

function listPrFiles(diff: string): CapturePrFile[] {
  return parseChangedRanges(diff).map((file) => ({
    path: file.file,
    additions: countRangeLines(file.addedRanges),
    deletions: countRangeLines(file.removedRanges),
  }));
}

function countRangeLines(ranges: readonly LineRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
}

function formatPrDiffKey(base: string, head: string): string {
  return `${base}...${head}`;
}

interface RecordedPrDiffs {
  source: PrSpanSource;
  /** Keyed `base...head`. */
  diffs: Map<string, string>;
}

/** A span source that keeps each PR diff it reads, so the capture stores what the span was built from. */
function recordPrDiffs(inner: PrSpanSource): RecordedPrDiffs {
  const diffs = new Map<string, string>();
  const source: PrSpanSource = {
    fetchBlob: (blob, signal) => inner.fetchBlob(blob, signal),
    async fetchPrDiff(span, signal) {
      const read = await inner.fetchPrDiff(span, signal);
      if (read.ok) {
        diffs.set(formatPrDiffKey(span.base, span.head), read.value);
      }
      return read;
    },
  };
  return { source, diffs };
}
