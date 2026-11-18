import type { Result } from "types/utils";
import { BODY_TOO_LARGE, readStreamWithinLimit } from "../../../../read-body";
import { THUMBNAIL_SOURCE_MAX_BYTES } from "../consts";
import { isAttachmentMediaType } from "./media-type";
import { resizeImage } from "./resize-image";
import {
  ThumbnailFailureKinds,
  type AttachmentBytes,
  type MediaStreamBudget,
  type ResizeTurn,
  type ThumbnailFailure,
} from "../types";

type ThumbnailResult = Result<Uint8Array<ArrayBuffer>, ThumbnailFailure>;

export type ThumbnailRefusalKind = Exclude<
  ThumbnailFailure["kind"],
  typeof ThumbnailFailureKinds.UNDECODABLE
>;

function refuse(kind: ThumbnailRefusalKind): ThumbnailResult {
  return { ok: false, error: { kind } };
}

async function readAndResize(
  original: AttachmentBytes,
  maxSourceBytes: number,
): Promise<ThumbnailResult> {
  let read;
  try {
    read = await readStreamWithinLimit(original.body, maxSourceBytes);
  } catch {
    return refuse(ThumbnailFailureKinds.UNREADABLE);
  }
  if (!read.ok && read.error === BODY_TOO_LARGE) {
    return refuse(ThumbnailFailureKinds.TOO_LARGE);
  }
  if (!read.ok) {
    return refuse(ThumbnailFailureKinds.UNREADABLE);
  }
  return resizeImage(read.value);
}

function readMaxSourceBytes(budget: MediaStreamBudget): number {
  return Math.min(budget.maxFileBytes, THUMBNAIL_SOURCE_MAX_BYTES);
}

/** What refuses the original from its type and named size alone, before a byte is read; undefined when nothing does. */
export function findThumbnailRefusal(
  budget: MediaStreamBudget,
  original: AttachmentBytes,
): ThumbnailRefusalKind | undefined {
  if (!isAttachmentMediaType(original.contentType)) {
    return ThumbnailFailureKinds.NOT_A_RASTER;
  }
  const namedTotal = original.extent?.total ?? 0;
  if (namedTotal > readMaxSourceBytes(budget)) {
    return ThumbnailFailureKinds.TOO_LARGE;
  }
  return undefined;
}

/**
 * The strip's thumbnail of an original the read already fetched, whole and
 * without a stream permit. A raster under the bound waits for one of the
 * process's resize turns before its body is buffered, so at most that many
 * originals sit in memory at once; every refusal cancels the body.
 */
export async function renderThumbnail(
  budget: MediaStreamBudget,
  original: AttachmentBytes,
  signal: AbortSignal,
): Promise<ThumbnailResult> {
  const refusal = findThumbnailRefusal(budget, original);
  if (refusal !== undefined) {
    await original.body.cancel();
    return refuse(refusal);
  }
  const maxSourceBytes = readMaxSourceBytes(budget);

  const turn: ResizeTurn | undefined =
    await budget.resizeTurns.waitForTurn(signal);
  if (turn === undefined) {
    await original.body.cancel();
    return refuse(ThumbnailFailureKinds.BUSY);
  }
  try {
    return await readAndResize(original, maxSourceBytes);
  } finally {
    turn.release();
  }
}
