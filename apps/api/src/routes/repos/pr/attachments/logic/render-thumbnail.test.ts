import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeNeverAbortingSignal } from "../../../../../../test/signals";
import {
  MAX_WAITING_RESIZES,
  RESIZE_TURN_WAIT_MS,
  THUMBNAIL_SOURCE_MAX_BYTES,
} from "../consts";
import { createResizeTurns } from "./resize-turns";
import { sniffImageMediaType } from "./sniff-image";
import { createStreamPermits } from "./stream-permits";
import { renderThumbnail } from "./render-thumbnail";
import type { AttachmentBytes, MediaStreamBudget } from "../types";

const MIB = 1024 * 1024;
const MEDIA_MAX_BYTES = 100 * MIB;

interface TrackedBody {
  readonly body: ReadableStream<Uint8Array>;
  isCancelled(): boolean;
}

function makeBudget(maxFileBytes = MEDIA_MAX_BYTES): MediaStreamBudget {
  return {
    maxFileBytes,
    permits: createStreamPermits(1),
    resizeTurns: createResizeTurns(1, RESIZE_TURN_WAIT_MS, MAX_WAITING_RESIZES),
  };
}

/** One chunk, then the stream stays open unless `ends`, as a slow upstream would. */
function trackBody(bytes: Uint8Array, ends = true): TrackedBody {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      if (ends) {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, isCancelled: () => cancelled };
}

function makeOriginal(
  body: ReadableStream<Uint8Array>,
  contentType = "image/png",
  total?: number,
): AttachmentBytes {
  if (total === undefined) {
    return { body, contentType };
  }
  return { body, contentType, extent: { first: 0, last: total - 1, total } };
}

async function makePng(width = 800, height = 400): Promise<Uint8Array> {
  return sharp({
    create: { width, height, channels: 3, background: "#3366ff" },
  })
    .png()
    .toBuffer();
}

describe("renderThumbnail", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers a webp thumbnail and frees its turn", async () => {
    const budget = makeBudget();
    const { body } = trackBody(await makePng());

    const rendered = await renderThumbnail(
      budget,
      makeOriginal(body),
      makeNeverAbortingSignal(),
    );

    expect(rendered.ok && sniffImageMediaType(rendered.value)).toBe(
      "image/webp",
    );
    expect(budget.resizeTurns.countRunning()).toBe(0);
  });

  it.each(["video/mp4", "image/svg+xml"])(
    "refuses a %s original without reading it",
    async (contentType) => {
      const tracked = trackBody(new Uint8Array([1, 2, 3]));

      const rendered = await renderThumbnail(
        makeBudget(),
        makeOriginal(tracked.body, contentType),
        makeNeverAbortingSignal(),
      );

      expect(rendered).toEqual({ ok: false, error: { kind: "not-a-raster" } });
      expect(tracked.isCancelled()).toBe(true);
    },
  );

  it("refuses an original whose named size passes the bound", async () => {
    const tracked = trackBody(new Uint8Array([1]));
    const total = THUMBNAIL_SOURCE_MAX_BYTES + 1;

    const rendered = await renderThumbnail(
      makeBudget(),
      makeOriginal(tracked.body, "image/png", total),
      makeNeverAbortingSignal(),
    );

    expect(rendered).toEqual({ ok: false, error: { kind: "too-large" } });
    expect(tracked.isCancelled()).toBe(true);
  });

  it("holds the bound to the media cap when the cap is lower", async () => {
    const png = await makePng();
    const tracked = trackBody(png);

    const rendered = await renderThumbnail(
      makeBudget(png.byteLength - 1),
      makeOriginal(tracked.body),
      makeNeverAbortingSignal(),
    );

    expect(rendered).toEqual({ ok: false, error: { kind: "too-large" } });
  });

  it("stops reading an unsized original once it passes the bound", async () => {
    const png = await makePng();
    const tracked = trackBody(png, false);

    const rendered = await renderThumbnail(
      makeBudget(png.byteLength - 1),
      makeOriginal(tracked.body, "image/png"),
      makeNeverAbortingSignal(),
    );

    expect(rendered).toEqual({ ok: false, error: { kind: "too-large" } });
    expect(tracked.isCancelled()).toBe(true);
  });

  it("answers busy when no turn frees within ten seconds", async () => {
    vi.useFakeTimers();
    const budget = makeBudget();
    const held = await budget.resizeTurns.waitForTurn(
      makeNeverAbortingSignal(),
    );
    const tracked = trackBody(new Uint8Array([1]));

    const rendered = renderThumbnail(
      budget,
      makeOriginal(tracked.body),
      makeNeverAbortingSignal(),
    );
    await vi.advanceTimersByTimeAsync(RESIZE_TURN_WAIT_MS);

    expect(await rendered).toEqual({ ok: false, error: { kind: "busy" } });
    expect(tracked.isCancelled()).toBe(true);
    held?.release();
  });

  it("fails an original that is no image and frees its turn", async () => {
    const budget = makeBudget();
    const { body } = trackBody(new TextEncoder().encode("<html></html>"));

    const rendered = await renderThumbnail(
      budget,
      makeOriginal(body),
      makeNeverAbortingSignal(),
    );

    expect(rendered).toEqual({ ok: false, error: { kind: "not-a-raster" } });
    expect(budget.resizeTurns.countRunning()).toBe(0);
  });

  it("fails an original whose upstream body breaks", async () => {
    const budget = makeBudget();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket hang up"));
      },
    });

    const rendered = await renderThumbnail(
      budget,
      makeOriginal(body),
      makeNeverAbortingSignal(),
    );

    expect(rendered).toEqual({ ok: false, error: { kind: "unreadable" } });
    expect(budget.resizeTurns.countRunning()).toBe(0);
  });
});
