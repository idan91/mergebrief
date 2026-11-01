import { ATTACHMENT_MAX_BYTES } from "contract";
import type { Result } from "types/utils";
import { MEDIA_FLOOR_BYTES_PER_MS, MEDIA_PIECE_DEADLINE_MS } from "../consts";
import {
  MediaReplyRefusalKinds,
  type ByteExtent,
  type MediaReplyRefusal,
  type ServedSlice,
  type WantedRange,
  type WholeReplyRefusal,
} from "../types";
import { resolveServedSlice } from "./byte-range";

/**
 * The slice one media reply serves. The cap reads the file's total from the
 * upstream answer, so every piece of an oversized file is refused, the first
 * one included; an answer naming no total cannot be judged and is refused.
 */
export function planMediaReply(
  extent: ByteExtent | undefined,
  wanted: WantedRange,
  maxFileBytes: number,
): Result<ServedSlice, MediaReplyRefusal> {
  if (extent === undefined) {
    return { ok: false, error: { kind: MediaReplyRefusalKinds.SIZE_UNKNOWN } };
  }
  if (extent.total > maxFileBytes) {
    return { ok: false, error: { kind: MediaReplyRefusalKinds.TOO_LARGE } };
  }
  return resolveServedSlice(wanted, extent);
}

function readFloorTransferMs(bytes: number): number {
  return Math.ceil(bytes / MEDIA_FLOOR_BYTES_PER_MS);
}

/**
 * How long a whole-image reply may stream: its bytes at the floor pace, never
 * under a piece's deadline and never over the time the cap takes. A declared
 * total past the cap is refused as a piece is; an answer naming no length is
 * sized as the largest image GitHub takes as a paste.
 */
export function planWholeReplyDeadline(
  extent: ByteExtent | undefined,
  maxFileBytes: number,
): Result<number, WholeReplyRefusal> {
  const total = extent?.total;
  if (total !== undefined && total > maxFileBytes) {
    return { ok: false, error: { kind: MediaReplyRefusalKinds.TOO_LARGE } };
  }

  const ceilingMs = readFloorTransferMs(maxFileBytes);
  const transferMs = readFloorTransferMs(total ?? ATTACHMENT_MAX_BYTES);
  const boundedMs = Math.min(transferMs, ceilingMs);
  return { ok: true, value: Math.max(MEDIA_PIECE_DEADLINE_MS, boundedMs) };
}
