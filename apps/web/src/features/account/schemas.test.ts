import { describe, expect, it } from "vitest";

import { parseViewer } from "./schemas";
import { ViewerStates } from "./types";

const VIEWER = { login: "octocat", avatarUrl: "https://cdn.example/a.png" };

describe("parseViewer", () => {
  it("reads a signed-in viewer from the session body", () => {
    expect(parseViewer({ viewer: VIEWER })).toEqual({
      kind: ViewerStates.SIGNED_IN,
      login: "octocat",
      avatarUrl: "https://cdn.example/a.png",
    });
  });

  it("reads a missing or non-string login as null", () => {
    const expected = {
      kind: ViewerStates.SIGNED_IN,
      login: null,
      avatarUrl: VIEWER.avatarUrl,
    };

    expect(parseViewer({ viewer: { avatarUrl: VIEWER.avatarUrl } })).toEqual(
      expected,
    );
    expect(parseViewer({ viewer: { ...VIEWER, login: 7 } })).toEqual(expected);
  });

  it("answers unknown for a body without a usable viewer", () => {
    const unknown = { kind: ViewerStates.UNKNOWN };

    expect(parseViewer(null)).toEqual(unknown);
    expect(parseViewer({})).toEqual(unknown);
    expect(parseViewer({ viewer: [] })).toEqual(unknown);
    expect(parseViewer({ viewer: { login: "octocat" } })).toEqual(unknown);
  });
});
