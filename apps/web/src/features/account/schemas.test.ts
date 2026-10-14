import type { AuthSessionResponse, ViewerView } from "contract";
import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import {
  parseViewer,
  type sessionBodySchema,
  type viewerSchema,
} from "./schemas";
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

  it("reads a missing, null or non-string login as absent", () => {
    const expected = {
      kind: ViewerStates.SIGNED_IN,
      avatarUrl: VIEWER.avatarUrl,
    };

    expect(
      parseViewer({ viewer: { avatarUrl: VIEWER.avatarUrl } }),
    ).toStrictEqual(expected);
    expect(parseViewer({ viewer: { ...VIEWER, login: null } })).toStrictEqual(
      expected,
    );
    expect(parseViewer({ viewer: { ...VIEWER, login: 7 } })).toStrictEqual(
      expected,
    );
  });

  it("answers unknown for a body without a usable viewer", () => {
    const unknown = { kind: ViewerStates.UNKNOWN };

    expect(parseViewer(null)).toEqual(unknown);
    expect(parseViewer({})).toEqual(unknown);
    expect(parseViewer({ viewer: [] })).toEqual(unknown);
    expect(parseViewer({ viewer: { login: "octocat" } })).toEqual(unknown);
  });
});

/** Every field the parser reads is one the contract sends. */
type ReadsWireFields<Parsed, Wire> = Equals<
  Exclude<keyof Parsed, keyof Wire>,
  never
>;

const CONTRACT_PINS = {
  AuthSessionResponse: true satisfies ReadsWireFields<
    z.output<typeof sessionBodySchema>,
    AuthSessionResponse
  >,
  ViewerView: true satisfies ReadsWireFields<
    z.output<typeof viewerSchema>,
    ViewerView
  >,
} as const;

describe("viewer schemas read only what the contract sends", () => {
  it.each(Object.entries(CONTRACT_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});
