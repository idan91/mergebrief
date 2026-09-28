// A request body read under a byte cap, cancelling the stream the moment
// the cap is crossed so an oversized upload never buffers: the webhook's
// signed payload and the attachment upload both enter through it.
import type { Result } from "types/utils";

export const BODY_TOO_LARGE = "body-too-large";
export type RawBodyResult = Result<Uint8Array, typeof BODY_TOO_LARGE>;

function declaresMoreThan(request: Request, maxBytes: number): boolean {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) {
    return false;
  }
  const declared = Number(contentLength);
  return Number.isFinite(declared) && declared > maxBytes;
}

/** The whole body as bytes, or the cap failure with the stream cancelled. */
export async function readRawBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<RawBodyResult> {
  if (declaresMoreThan(request, maxBytes)) {
    await request.body?.cancel();
    return { ok: false, error: BODY_TOO_LARGE };
  }
  if (request.body === null) {
    return { ok: true, value: new Uint8Array(0) };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      // Stream reads are inherently sequential, each chunk arrives only
      // after the previous read resolves, so there is nothing to parallelize.
      // oxlint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        return { ok: true, value: concatChunks(chunks, bytesRead) };
      }
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        // oxlint-disable-next-line no-await-in-loop
        await reader.cancel();
        return { ok: false, error: BODY_TOO_LARGE };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function concatChunks(
  chunks: readonly Uint8Array[],
  total: number,
): Uint8Array {
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
