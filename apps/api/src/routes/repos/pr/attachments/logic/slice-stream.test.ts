import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDIA_PIECE_DEADLINE_MS } from "../consts";
import { sliceStream } from "./slice-stream";

interface SourceSpy {
  readonly stream: ReadableStream<Uint8Array>;
  readonly cancel: ReturnType<typeof vi.fn>;
}

function makeSource(chunks: readonly number[][], failAt?: number): SourceSpy {
  const cancel = vi.fn();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === failAt) {
        controller.error(new Error("upstream reset"));
        return;
      }
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
  return { stream, cancel };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const bytes: number[] = [];
  for await (const chunk of stream) {
    bytes.push(...chunk);
  }
  return bytes;
}

describe("sliceStream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips into the source and serves the slice across chunks", async () => {
    const source = makeSource([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7],
    ]);
    const settled = vi.fn();

    const slice = sliceStream(
      source.stream,
      { skip: 2, length: 4 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );

    expect(await readAll(slice)).toEqual([2, 3, 4, 5]);
    expect(source.cancel).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("serves a slice that ends where the source ends", async () => {
    const source = makeSource([
      [0, 1],
      [2, 3],
    ]);
    const settled = vi.fn();

    const slice = sliceStream(
      source.stream,
      { skip: 0, length: 4 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );

    expect(await readAll(slice)).toEqual([0, 1, 2, 3]);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("cancels the source and settles once when the reader leaves", async () => {
    const source = makeSource([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    const settled = vi.fn();
    const slice = sliceStream(
      source.stream,
      { skip: 0, length: 6 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );
    const reader = slice.getReader();

    await reader.read();
    await reader.cancel();

    expect(source.cancel).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("errors and settles once when the source fails", async () => {
    const source = makeSource([[0, 1]], 1);
    const settled = vi.fn();

    const slice = sliceStream(
      source.stream,
      { skip: 0, length: 4 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );

    await expect(readAll(slice)).rejects.toThrow("upstream reset");
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("errors rather than serve fewer bytes than its length", async () => {
    const source = makeSource([[0, 1]]);
    const settled = vi.fn();

    const slice = sliceStream(
      source.stream,
      { skip: 0, length: 4 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );

    await expect(readAll(slice)).rejects.toThrow(
      "upstream ended before the served range",
    );
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("reads nothing from the source until the reader asks", async () => {
    const source = makeSource([[0, 1]]);
    const settled = vi.fn();

    const slice = sliceStream(
      source.stream,
      { skip: 0, length: 2 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    expect(await readAll(slice)).toEqual([0, 1]);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("settles and cancels the source when the request already left", async () => {
    const source = makeSource([[0, 1]]);
    const settled = vi.fn();
    const request = new AbortController();
    request.abort();

    const slice = sliceStream(
      source.stream,
      { skip: 0, length: 2 },
      {
        signal: request.signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );
    await Promise.resolve();

    expect(settled).toHaveBeenCalledTimes(1);
    expect(source.cancel).toHaveBeenCalledTimes(1);
    await expect(readAll(slice)).rejects.toThrow("aborted");
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("settles and cancels the source when the request leaves mid-piece", async () => {
    const source = makeSource([
      [0, 1],
      [2, 3],
    ]);
    const settled = vi.fn();
    const request = new AbortController();
    const slice = sliceStream(
      source.stream,
      { skip: 0, length: 4 },
      {
        signal: request.signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );
    const reader = slice.getReader();

    await reader.read();
    request.abort();

    expect(settled).toHaveBeenCalledTimes(1);
    expect(source.cancel).toHaveBeenCalledTimes(1);
    await expect(reader.read()).rejects.toThrow("aborted");
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("settles and cancels the source when an unread piece hits its deadline", async () => {
    vi.useFakeTimers();
    const source = makeSource([[0, 1]]);
    const settled = vi.fn();
    const slice = sliceStream(
      source.stream,
      { skip: 0, length: 2 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );

    await vi.advanceTimersByTimeAsync(MEDIA_PIECE_DEADLINE_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(source.cancel).toHaveBeenCalledTimes(1);
    await expect(readAll(slice)).rejects.toThrow(
      "media reply outlived its deadline",
    );
  });

  it("settles once and leaves no deadline behind a served piece", async () => {
    vi.useFakeTimers();
    const source = makeSource([[0, 1]]);
    const settled = vi.fn();
    const slice = sliceStream(
      source.stream,
      { skip: 0, length: 2 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );

    expect(await readAll(slice)).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(MEDIA_PIECE_DEADLINE_MS);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes a whole file through when the window names no length", async () => {
    const source = makeSource([[0, 1], [2]]);
    const settled = vi.fn();
    const slice = sliceStream(
      source.stream,
      { skip: 0 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );

    expect(await readAll(slice)).toEqual([0, 1, 2]);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("holds a slice open until the deadline it was given", async () => {
    vi.useFakeTimers();
    const longDeadline = MEDIA_PIECE_DEADLINE_MS * 3;
    const source = makeSource([[0, 1]]);
    const settled = vi.fn();
    sliceStream(
      source.stream,
      { skip: 0 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: longDeadline,
      },
    );

    await vi.advanceTimersByTimeAsync(MEDIA_PIECE_DEADLINE_MS);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(longDeadline - MEDIA_PIECE_DEADLINE_MS);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(source.cancel).toHaveBeenCalledTimes(1);
  });

  it("ends a whole file left unread at the deadline", async () => {
    vi.useFakeTimers();
    const source = makeSource([[0, 1]]);
    const settled = vi.fn();
    sliceStream(
      source.stream,
      { skip: 0 },
      {
        signal: new AbortController().signal,
        onSettled: settled,
        deadlineMs: MEDIA_PIECE_DEADLINE_MS,
      },
    );

    await vi.advanceTimersByTimeAsync(MEDIA_PIECE_DEADLINE_MS);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(source.cancel).toHaveBeenCalledTimes(1);
  });
});
