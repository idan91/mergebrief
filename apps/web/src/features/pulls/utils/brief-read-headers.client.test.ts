// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { buildBriefReadHeaders } from "./brief-read-headers";

describe("buildBriefReadHeaders in the browser", () => {
  it("never asks for a warm: a hover preload reads the brief too", () => {
    expect(typeof window).toBe("object");
    expect(buildBriefReadHeaders()).toEqual({});
  });
});
