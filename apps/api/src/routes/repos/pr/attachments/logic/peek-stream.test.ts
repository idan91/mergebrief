import { describe, expect, it, vi } from "vitest";
import { readStreamHead } from "./peek-stream";

function makeStream(chunks: readonly number[][], cancel = vi.fn()) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunk));
    },
    cancel,
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  return Array.from(new Uint8Array(await new Response(stream).arrayBuffer()));
}

describe("readStreamHead", () => {
  it("reads chunks until the head holds enough and replays every byte", async () => {
    const peeked = await readStreamHead(makeStream([[1, 2], [3, 4], [5]]), 3);

    expect(Array.from(peeked.head)).toEqual([1, 2, 3, 4]);
    expect(await readAll(peeked.body)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a short head when the stream ends first", async () => {
    const peeked = await readStreamHead(makeStream([[1]]), 8);

    expect(Array.from(peeked.head)).toEqual([1]);
    expect(await readAll(peeked.body)).toEqual([1]);
  });

  it("cancels the upstream when the replay is cancelled", async () => {
    const cancel = vi.fn();
    const peeked = await readStreamHead(makeStream([[1], [2]], cancel), 1);

    await peeked.body.cancel();

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
