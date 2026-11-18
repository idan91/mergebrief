/** The leading bytes of a stream, and a stream that replays them before the rest. */
export interface StreamHead {
  readonly head: Uint8Array;
  readonly body: ReadableStream<Uint8Array>;
}

function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** Reads whole chunks until at least `minBytes` arrived or the stream ended; the rest stays unread. */
export async function readStreamHead(
  source: ReadableStream<Uint8Array>,
  minBytes: number,
): Promise<StreamHead> {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let ended = false;
  while (length < minBytes) {
    const next = await reader.read();
    if (next.done) {
      ended = true;
      break;
    }
    chunks.push(next.value);
    length += next.value.byteLength;
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      if (ended) {
        controller.close();
      }
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head: joinChunks(chunks), body };
}
