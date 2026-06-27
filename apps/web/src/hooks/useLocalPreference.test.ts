// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useLocalPreference } from "./useLocalPreference";
import { useScrollSpy } from "./useScrollSpy";

afterEach(() => {
  window.localStorage.clear();
});

describe("useLocalPreference", () => {
  it("returns the default when nothing is stored", () => {
    const { result } = renderHook(() => useLocalPreference("pref-a", true));
    expect(result.current[0]).toBe(true);
  });

  it("persists and reads back a value", () => {
    const { result } = renderHook(() => useLocalPreference("pref-b", false));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem("pref-b")).toBe("true");

    const second = renderHook(() => useLocalPreference("pref-b", false));
    expect(second.result.current[0]).toBe(true);
  });

  it("falls back to the default on corrupt stored JSON", () => {
    window.localStorage.setItem("pref-c", "not json");
    const { result } = renderHook(() =>
      useLocalPreference("pref-c", "fallback"),
    );
    expect(result.current[0]).toBe("fallback");
  });
});

describe("useScrollSpy", () => {
  it("returns null when given no ids", () => {
    const { result } = renderHook(() => useScrollSpy([]));
    expect(result.current).toBeNull();
  });

  it("activates the element crossing the reading line", () => {
    const target = document.createElement("div");
    target.id = "chunk-x";
    document.body.appendChild(target);
    target.getBoundingClientRect = () => ({ top: 100, bottom: 200 }) as DOMRect;

    const { result } = renderHook(() => useScrollSpy(["chunk-x"], 150));
    expect(result.current).toBe("chunk-x");
    target.remove();
  });
});
