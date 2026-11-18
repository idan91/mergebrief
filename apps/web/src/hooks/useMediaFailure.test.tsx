// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useImageFailure, useVideoFailure } from "./useMediaFailure";

describe("useImageFailure", () => {
  it("fails the source it was marked on and starts fresh on a new one", () => {
    const { result, rerender } = renderHook(
      ({ source }) => useImageFailure(source),
      { initialProps: { source: "https://a.test/one.png" } },
    );

    act(() => {
      result.current.markFailed();
    });
    expect(result.current.failed).toBe(true);

    rerender({ source: "https://a.test/two.png" });
    expect(result.current.failed).toBe(false);
  });
});

describe("useVideoFailure", () => {
  it("fails a player that raised its error before the hook ran", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "error", { value: { code: 4 } });

    const { result } = renderHook(() => {
      const failure = useVideoFailure("https://a.test/clip.mp4");
      failure.mediaRef.current = video;
      return failure;
    });

    expect(result.current.failed).toBe(true);
  });
});
