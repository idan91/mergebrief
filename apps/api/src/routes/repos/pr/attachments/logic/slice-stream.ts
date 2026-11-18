import type { SliceStreamOptions, StreamWindow } from "../types";

/** No read-ahead: a chunk is pulled only when the reader asks, so a permit stays held until then. */
const PULL_ON_READ = new CountQueuingStrategy({ highWaterMark: 0 });

interface SliceProgress {
  toSkip: number;
  remaining: number;
}

/** The next chunk inside the window, or undefined once the source ended first. */
async function readWindowChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  progress: SliceProgress,
): Promise<Uint8Array | undefined> {
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      return undefined;
    }
    const chunk = next.value;
    if (progress.toSkip >= chunk.byteLength) {
      progress.toSkip -= chunk.byteLength;
      continue;
    }
    const end = progress.toSkip + progress.remaining;
    const served = chunk.subarray(progress.toSkip, end);
    progress.toSkip = 0;
    progress.remaining -= served.byteLength;
    return served;
  }
}

/**
 * `window.length` bytes of `source` after its first `window.skip`, or every
 * byte to its end when no length is named, pulled as the reader asks, never
 * buffered. `onSettled` runs exactly once: when the
 * window is served, the source fails or ends short, the reader cancels, the
 * request aborts (already aborted included), or `options.deadlineMs`
 * passes. A short source errors the stream rather than end it under a
 * promised length.
 */
export function sliceStream(
  source: ReadableStream<Uint8Array>,
  window: StreamWindow,
  options: SliceStreamOptions,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const progress = {
    toSkip: window.skip,
    remaining: window.length ?? Number.POSITIVE_INFINITY,
  };
  let settled = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let sliceController: ReadableStreamDefaultController<Uint8Array> | undefined;
  function settle(): void {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(deadline);
    options.signal.removeEventListener("abort", abortSlice);
    options.onSettled();
  }
  function endEarly(reason: unknown): void {
    settle();
    sliceController?.error(reason);
    // The piece is already over; a failing upstream cancel changes nothing.
    reader.cancel(reason).catch(() => undefined);
  }
  function abortSlice(): void {
    endEarly(options.signal.reason);
  }

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        sliceController = controller;
        if (options.signal.aborted) {
          abortSlice();
          return;
        }
        options.signal.addEventListener("abort", abortSlice, { once: true });
        deadline = setTimeout(() => {
          endEarly(new Error("media reply outlived its deadline"));
        }, options.deadlineMs);
      },
      async pull(controller) {
        let chunk: Uint8Array | undefined;
        try {
          chunk = await readWindowChunk(reader, progress);
        } catch (error) {
          settle();
          controller.error(error);
          return;
        }
        if (settled) {
          return;
        }
        const sourceEndedWhole =
          chunk === undefined && window.length === undefined;
        if (sourceEndedWhole) {
          settle();
          controller.close();
          return;
        }
        if (chunk === undefined) {
          settle();
          controller.error(new Error("upstream ended before the served range"));
          return;
        }

        controller.enqueue(chunk);
        if (progress.remaining === 0) {
          settle();
          controller.close();
          await reader.cancel();
        }
      },
      async cancel(reason) {
        settle();
        await reader.cancel(reason);
      },
    },
    PULL_ON_READ,
  );
}
