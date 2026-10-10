// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import { createFileRowsCache } from "./cache";
import { FileRowsProvider, useFileRows } from "./useFileRows";

describe("useFileRows", () => {
  it("hands back the cache the provider holds", () => {
    const cache = createFileRowsCache(new Map());
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FileRowsProvider cache={cache}>{children}</FileRowsProvider>
    );
    const { result } = renderHook(() => useFileRows(), { wrapper });

    expect(result.current).toBe(cache);
  });

  it("is undefined where no provider holds a diff", () => {
    const { result } = renderHook(() => useFileRows());

    expect(result.current).toBeUndefined();
  });
});
