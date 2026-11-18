// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useFocusArrival } from "./useFocusArrival";

const CHUNK_IDS = ["c1", "c2"];

function mountFocusArrival(link: string | undefined, focusInUrl = true) {
  const startReadThrough = vi.fn();
  renderHook(() =>
    useFocusArrival({
      focusInUrl,
      link,
      chunkIds: CHUNK_IDS,
      startReadThrough,
    }),
  );
  return startReadThrough;
}

describe("useFocusArrival", () => {
  it("opens on the first chunk when focus arrives without a chunk link", () => {
    expect(mountFocusArrival("unknown-chunk")).toHaveBeenCalledTimes(1);
  });

  it("lets a chunk link scroll when focus arrives with one", () => {
    expect(mountFocusArrival("c2")).not.toHaveBeenCalled();
  });

  it("starts nothing when the page arrives outside Focus mode", () => {
    expect(mountFocusArrival(undefined, false)).not.toHaveBeenCalled();
  });
});
