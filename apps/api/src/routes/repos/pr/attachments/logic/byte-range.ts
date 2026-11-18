// The `Range` a media element sends and the `Content-Range` upstream answers,
// read strictly. A header this module cannot read whole is ignored rather
// than refused, which a server may always do with `Range`.
import type { Result } from "types/utils";
import {
  ByteRangeKinds,
  SliceRefusalKinds,
  type ByteExtent,
  type RequestedRange,
  type ServedSlice,
  type SliceRefusal,
  type WantedRange,
} from "../types";

/** Fifteen digits stay inside a safe integer. */
const RANGE_SPEC = /^bytes\s*=\s*(\d{1,15})?-(\d{1,15})?\s*$/i;
const CONTENT_RANGE = /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15})$/;

function readFromRange(
  first: string,
  last: string | undefined,
): RequestedRange | undefined {
  const start = Number(first);
  if (last === undefined) {
    return { kind: ByteRangeKinds.FROM, first: start };
  }
  const end = Number(last);
  if (end < start) {
    return undefined;
  }
  return { kind: ByteRangeKinds.FROM, first: start, last: end };
}

/** One `bytes=` range; a list, another unit, a zero suffix or anything malformed is ignored. */
export function parseRangeHeader(
  header: string | undefined,
): RequestedRange | undefined {
  const match = RANGE_SPEC.exec(header?.trim() ?? "");
  if (match === null) {
    return undefined;
  }

  const [, first, last] = match;
  if (first !== undefined) {
    return readFromRange(first, last);
  }
  const isEmptySuffix = last === undefined || Number(last) === 0;
  if (isEmptySuffix) {
    return undefined;
  }
  return { kind: ByteRangeKinds.SUFFIX, length: Number(last) };
}

/** The range one reply serves: at most `pieceBytes`, the first piece when the client named none. */
export function clampRequestedRange(
  requested: RequestedRange | undefined,
  pieceBytes: number,
): WantedRange {
  if (requested === undefined) {
    return { kind: ByteRangeKinds.FROM, first: 0, last: pieceBytes - 1 };
  }
  if (requested.kind === ByteRangeKinds.SUFFIX) {
    const length = Math.min(requested.length, pieceBytes);
    return { kind: ByteRangeKinds.SUFFIX, length };
  }

  const pieceLast = requested.first + pieceBytes - 1;
  const last = Math.min(requested.last ?? pieceLast, pieceLast);
  return { kind: ByteRangeKinds.FROM, first: requested.first, last };
}

/**
 * The `Range` sent upstream. A piece starting inside the first `sniffWindow`
 * bytes is asked for from byte zero and at least that far, so the file's
 * signature is read even for WebKit's two-byte probe.
 */
export function formatUpstreamRange(
  wanted: WantedRange,
  sniffWindow: number,
): string {
  if (wanted.kind === ByteRangeKinds.SUFFIX) {
    return `bytes=-${wanted.length}`;
  }
  if (wanted.first < sniffWindow) {
    return `bytes=0-${Math.max(wanted.last, sniffWindow - 1)}`;
  }
  return `bytes=${wanted.first}-${wanted.last}`;
}

/** A satisfied `bytes first-last/total`; an unknown total or an impossible range is refused. */
export function parseContentRange(
  header: string | undefined,
): ByteExtent | undefined {
  const match = CONTENT_RANGE.exec(header ?? "");
  if (match === null) {
    return undefined;
  }

  const [, first = "", last = "", total = ""] = match;
  const extent = {
    first: Number(first),
    last: Number(last),
    total: Number(total),
  };
  const isPossible = extent.first <= extent.last && extent.last < extent.total;
  return isPossible ? extent : undefined;
}

function resolveWantedStart(wanted: WantedRange, total: number): number {
  if (wanted.kind === ByteRangeKinds.SUFFIX) {
    return Math.max(0, total - wanted.length);
  }
  return wanted.first;
}

/** The wanted bytes inside what upstream answered, ending at the file's last byte. */
export function resolveServedSlice(
  wanted: WantedRange,
  extent: ByteExtent,
): Result<ServedSlice, SliceRefusal> {
  const { total } = extent;
  const first = resolveWantedStart(wanted, total);
  if (first >= total) {
    const error = { kind: SliceRefusalKinds.UNSATISFIABLE, total };
    return { ok: false, error };
  }
  const isCovered = extent.first <= first && first <= extent.last;
  if (!isCovered) {
    return { ok: false, error: { kind: SliceRefusalKinds.NOT_COVERED } };
  }

  const wantedLast = wanted.kind === ByteRangeKinds.FROM ? wanted.last : total;
  const last = Math.min(wantedLast, extent.last);
  const slice = {
    first,
    last,
    total,
    skip: first - extent.first,
    length: last - first + 1,
  };
  return { ok: true, value: slice };
}

export function formatContentRange(slice: ByteExtent): string {
  return `bytes ${slice.first}-${slice.last}/${slice.total}`;
}
