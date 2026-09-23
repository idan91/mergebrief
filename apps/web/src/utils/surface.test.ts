import { describe, expect, it } from "vitest";

import { resolveSurface, Surfaces } from "./surface";

describe("resolveSurface", () => {
  it("names the repo pull request route a brief surface", () => {
    expect(resolveSurface("/repos/424242/pulls/1")).toBe(Surfaces.BRIEF);
  });

  it("names the local brief route a brief surface", () => {
    expect(resolveSurface("/briefs/abc")).toBe(Surfaces.BRIEF);
  });

  it("names home and everything else the home surface", () => {
    expect(resolveSurface("/")).toBe(Surfaces.HOME);
    expect(resolveSurface("/settings")).toBe(Surfaces.HOME);
    expect(resolveSurface("/repositories")).toBe(Surfaces.HOME);
  });
});
