import { describe, expect, it } from "vitest";
import { isUntracedPath } from "../../src/tracing/untraced-paths";

describe("isUntracedPath", () => {
  it("skips the probes whatever their query", () => {
    expect(isUntracedPath("/healthz", [])).toBe(true);
    expect(isUntracedPath("/readyz?full=1", [])).toBe(true);
  });

  it("skips a path under an app-named prefix", () => {
    expect(isUntracedPath("/assets/index-abc.js", ["/assets/"])).toBe(true);
    expect(isUntracedPath("/favicon.svg", ["/favicon.svg"])).toBe(true);
  });

  it("traces everything else", () => {
    expect(isUntracedPath("/", ["/assets/"])).toBe(false);
    expect(isUntracedPath("/api/healthz", [])).toBe(false);
  });
});
